#!/usr/bin/env python3
"""Build explicitly selected .com images after the caller verifies the SG target.

Uses the managed job's Docker login; never starts/prunes Docker or changes Git.
Source tags identify a committed, clean main revision. Docker applies the
archived repository's .dockerignore; local edits never enter the build context.
"""
import io
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import re
from shutil import copyfileobj
import subprocess
import tarfile
import tempfile
from urllib.parse import urlsplit
from typing import Optional

PUSH_HOST = "fizzdragon-com-sg-registry-vpc.ap-southeast-1.cr.aliyuncs.com"
RUNTIME_HOST = "fizzdragon-com-sg-registry-vpc.ap-southeast-1.cr.aliyuncs.com"
SERVICES = {"web", "server", "studio", "admin-ui", "agent-os", "game-agent", "app-story-agent"}
BUILD_ENV = "apps/web/.env.production.com"
NPM_REGISTRY_ENV = "FIZZ_COM_NPM_REGISTRY"


class BuildError(RuntimeError):
    """Locally authored, credential-free build errors safe for the entrypoint."""


PUBLIC_ARGS = {
    "NEXT_PUBLIC_OSS_BASE_URL", "NEXT_PUBLIC_BANNER_BASE_URL",
    "NEXT_PUBLIC_USER_BASE_URL", "NEXT_PUBLIC_SITE_REGION",
    "NEXT_PUBLIC_PARENT_ORIGIN", "NEXT_PUBLIC_WS_HOST",
    "NEXT_PUBLIC_API_CONTENT_PREFIX", "NEXT_PUBLIC_API_STUDIO_PREFIX",
    "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "NEXT_PUBLIC_POSTHOG_HOST",
    "NEXT_PUBLIC_AXON_PIXEL_KEY", "NEXT_PUBLIC_STUDIO_HOST",
    "NEXT_PUBLIC_CONTENT_GPS_MAP_ENABLED", "NEXT_PUBLIC_CONTENT_GPS_GOOGLE_KEY",
    "NEXT_PUBLIC_CONTENT_GPS_GOOGLE_MAP_ID", "NEXT_PUBLIC_CONTENT_GPS_GAODE_KEY",
    "NEXT_PUBLIC_CONTENT_GPS_GAODE_PROXY_PATH",
}


def optional_npm_registry(value=None) -> Optional[str]:
    candidate = value if value is not None else os.environ.get(NPM_REGISTRY_ENV, "")
    if candidate is None:
        return None
    registry = str(candidate).strip()
    if not registry:
        return None
    if not re.fullmatch(r"https://[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+", registry):
        raise BuildError("NPM registry must be an https URL (set --npm-registry or FIZZ_COM_NPM_REGISTRY)")
    return registry


def parse_build_env(path: Path) -> dict[str, str]:
    """Read approved public/.com URLs as data, never as shell instructions."""
    allowed = PUBLIC_ARGS | {"JAVA_STUDIO_URL", "JAVA_CONTENT_URL"}
    result = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if separator and key in allowed:
            if value[:1] in ("'", '"'):
                if len(value) < 2 or value[-1] != value[0]:
                    raise ValueError(f"Unclosed build value for {key}")
                value = value[1:-1]
            if "\x00" in value or "\r" in value:
                raise ValueError(f"Invalid build value for {key}")
            result[key] = value
    if result.get("NEXT_PUBLIC_SITE_REGION") != "global":
        raise ValueError("The .com build requires NEXT_PUBLIC_SITE_REGION=global")
    for key, expected in {
        "JAVA_STUDIO_URL": "https://java.fizzdragon.com/studio",
        "JAVA_CONTENT_URL": "https://java.fizzdragon.com/content",
    }.items():
        if result.get(key) != expected:
            raise ValueError(f"The .com build requires {key}={expected}")
    return result


def committed_source(root: Path) -> str:
    """Pin clean main once; never fetch, switch branches, commit or follow HEAD."""
    try:
        branch = subprocess.run(["git", "symbolic-ref", "--short", "HEAD"], cwd=root,
                                capture_output=True, text=True, check=True).stdout.strip()
        if branch != "main":
            raise BuildError("Production publishing requires the main branch; synchronize main before publishing")
        status = subprocess.run(["git", "status", "--porcelain=v1", "--untracked-files=all", "-z"],
                                cwd=root, capture_output=True, check=True).stdout
        if status:
            raise BuildError("Production publishing requires a clean main worktree; commit or preserve local changes first")
        source = subprocess.run(["git", "rev-parse", "--verify", "HEAD"], cwd=root,
                                capture_output=True, text=True, check=True).stdout.strip()
        if not re.fullmatch(r"[0-9a-f]{40}", source):
            raise BuildError("Cannot verify the committed main revision")
        return source
    except (OSError, subprocess.SubprocessError):
        raise BuildError("Cannot verify clean main; check the repository and Git installation") from None


def source_snapshot(root: Path, destination: Path, source: str) -> str:
    """Extract the exact committed revision without reading working-tree source."""
    root = root.resolve()
    if destination.resolve().is_relative_to(root):
        raise ValueError("Build snapshot must be outside the working tree")
    if not re.fullmatch(r"[0-9a-f]{40}", source):
        raise BuildError("A full committed source revision is required")
    archive = subprocess.run(["git", "archive", "--format=tar", source],
                             cwd=root, capture_output=True, check=True).stdout
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:") as snapshot:
        for entry in snapshot:
            relative = Path(entry.name)
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError("Git returned an unsafe source path")
            if entry.isdir():
                continue
            if not entry.isfile():
                raise ValueError(f"Unsupported source entry: {relative}")
            if relative.name.startswith(".env") and relative.as_posix() != BUILD_ENV:
                continue
            copied = destination / relative
            if not copied.resolve().is_relative_to(destination.resolve()):
                raise ValueError("Build destination contains an unsafe path")
            copied.parent.mkdir(parents=True, exist_ok=True)
            with snapshot.extractfile(entry) as content, copied.open("wb") as target:
                copyfileobj(content, target)
            copied.chmod(0o644 | (entry.mode & 0o111))
    if not (destination / ".dockerignore").is_file():
        raise ValueError("Repository .dockerignore is required")
    return source


def require_harness_source(context: Path, services: list[str]) -> None:
    if not set(services) & {"server", "studio", "game-agent"}:
        return
    checks = {
        "apps/game-agent/src/main.ts": "readGameAgentServiceConfig",
        "apps/game-agent/src/appearance/harness.ts": "harness",
        "apps/server/src/app.module.ts": "GameAgentModule",
        "apps/server/src/game-agent/game-agent.config.ts": "GAME_AGENT_ENABLED",
        "apps/studio/app/[locale]/story-studio/_components/appearance-design/appearance-preview.tsx":
            "/aurora/game-agent/",
    }
    for relative, marker in checks.items():
        path = context / relative
        if not path.is_file() or marker not in path.read_text(encoding="utf-8"):
            raise ValueError(f"Current Harness integration is missing: {relative}")
    for relative in ("apps/game-agent/Dockerfile", "packages/game-agent-protocol/package.json"):
        if not (context / relative).is_file():
            raise ValueError(f"Current Harness source is missing: {relative}")


def docker_environment() -> dict[str, str]:
    """Use Flow's temporary Docker login and its existing job-local daemon."""
    environment = dict(os.environ)
    host = environment.get("DOCKER_HOST", "")
    if not host or environment.get("DOCKER_CONTEXT"):
        inspected = subprocess.run(
            ["docker", "context", "inspect"], capture_output=True, text=True, check=False,
        )
        try:
            host = json.loads(inspected.stdout)[0]["Endpoints"]["docker"]["Host"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise BuildError("Cannot resolve the job-local Docker daemon") from None
        if inspected.returncode:
            raise BuildError("Cannot inspect the current Docker context")
    try:
        endpoint = urlsplit(host)
        local_tcp = (
            endpoint.scheme == "tcp" and endpoint.hostname in ("localhost", "127.0.0.1", "::1")
            and endpoint.port in (2375, 2376) and not endpoint.path
            and endpoint.username is None and endpoint.password is None
            and not endpoint.query and not endpoint.fragment
        )
    except (TypeError, ValueError):
        local_tcp = False
    if not isinstance(host, str) or not (host.startswith(("unix://", "npipe://")) or local_tcp):
        raise BuildError("The .com image builder requires the job-local Docker daemon")
    for key in ("DOCKER_CONTEXT", "BUILDX_BUILDER", "BUILDX_CONFIG", "BUILDKIT_HOST"):
        environment.pop(key, None)
    environment["DOCKER_HOST"] = host
    for command in (["docker", "info"], ["docker", "buildx", "version"]):
        checked = subprocess.run(command, env=environment, capture_output=True, check=False)
        if checked.returncode:
            raise BuildError("Docker and buildx must be available in the managed job")
    return environment


def service_inputs(root, source, service, npm_registry=None):
    spec = importlib.util.spec_from_file_location(
        "sg_release_inputs", Path(__file__).resolve().parents[1] / "release_inputs.py")
    identity = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(identity)
    fingerprint = identity.inputs(root, source, service, "com")
    if npm_registry:
        fingerprint = hashlib.sha256(f"{fingerprint}\0npm-registry={npm_registry}".encode()).hexdigest()
    return fingerprint


def find_reusable_image(root, source, service, image, environment, npm_registry=None):
    """Reuse the running immutable image only when its committed inputs match."""
    prefix = f"{RUNTIME_HOST}/fizzdragon/fizzdragon-{service}@"
    if not isinstance(image, str) or not re.fullmatch(re.escape(prefix) + r"sha256:[0-9a-f]{64}", image):
        raise BuildError("Cannot verify the current Singapore production image")
    inspected = subprocess.run(
        ["docker", "buildx", "imagetools", "inspect", image, "--format", "{{json .Image}}"],
        env=environment, capture_output=True, text=True, timeout=60, check=False,
    )
    if inspected.returncode:
        raise BuildError("Singapore image metadata lookup failed; check the native ACR login")
    try:
        config = json.loads(inspected.stdout)
        if config.get("os") != "linux" or config.get("architecture") != "amd64":
            raise BuildError("The current Singapore image must target linux/amd64")
        labels = config.get("config", {}).get("Labels")
        if labels is None:
            labels = {}
        if not isinstance(labels, dict):
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise BuildError("Singapore registry returned invalid image metadata") from None
    fingerprint = labels.get("com.fizzdragon.release-inputs")
    if fingerprint is None:
        # Images built before managed publishing are rebuilt once to establish
        # their inputs. Never infer source equivalence from an unlabelled tag.
        return None
    revision = labels.get("org.opencontainers.image.revision")
    if (not isinstance(fingerprint, str) or not re.fullmatch(r"[0-9a-f]{64}", fingerprint)
            or not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision)):
        raise BuildError("Singapore image has invalid release identity labels")
    ancestor = subprocess.run(
        ["git", "-C", str(root), "merge-base", "--is-ancestor", revision, source],
        capture_output=True, check=False,
    )
    if ancestor.returncode not in (0, 1):
        raise BuildError("Cannot verify the running image's committed source ancestry")
    if ancestor.returncode or fingerprint != service_inputs(root, source, service, npm_registry):
        return None
    print(f"Reusing .com {service} ({image.rsplit('@', 1)[1]}); no build", flush=True)
    return image


def build_images(root: Path, services: list[str], current_images, source=None, npm_registry=None) -> dict[str, str]:
    """Push all selected amd64 images; return exact VPC runtime digest references."""
    if not services or len(set(services)) != len(services) or not set(services) <= SERVICES:
        raise ValueError("Select unique services: web server studio admin-ui agent-os game-agent app-story-agent")
    source = source or committed_source(root)
    registry = optional_npm_registry(npm_registry)
    environment = docker_environment()
    images = {}
    missing = []
    for service in services:
        current = current_images.get(service)
        existing = find_reusable_image(root, source, service, current, environment, registry) if service in current_images else None
        if existing:
            images[service] = existing
        else:
            missing.append(service)
    if not missing:
        return images
    services = missing
    with tempfile.TemporaryDirectory(prefix="fizzdragon-com-build-") as directory:
        temporary = Path(directory)
        context = temporary / "source"
        context.mkdir()
        tag = source_snapshot(root, context, source)
        require_harness_source(context, services)
        public = parse_build_env(context / BUILD_ENV)
        for service in services:
            arguments = {}
            if service == "web":
                arguments = {key: value for key, value in public.items() if key in PUBLIC_ARGS}
                arguments.update({"SERVER_URL": "http://fizzdragon-server:3001",
                                  "JAVA_STUDIO_URL": public["JAVA_STUDIO_URL"],
                                  "JAVA_CONTENT_URL": public["JAVA_CONTENT_URL"]})
            elif service == "studio":
                arguments = {key: public[key] for key in
                             ("JAVA_STUDIO_URL", "JAVA_CONTENT_URL", "NEXT_PUBLIC_SITE_REGION")}
                arguments.update({"AURORA_PROXY_TARGET": "http://fizzdragon-server:3001",
                                  "AURORA_STRIP_PREFIX": "1"})
            elif service == "admin-ui":
                arguments = {"NEXT_PUBLIC_ADMIN_UI_BASE_PATH": "/"}
            if registry:
                arguments["NPM_REGISTRY"] = registry
            metadata = temporary / f"{service}-metadata.json"
            command = [
                "docker", "buildx", "build", "--builder", "default", "--platform", "linux/amd64", "--load",
                "--provenance=false", "--metadata-file", str(metadata), "--progress=plain",
                "--file", str(context / f"apps/{service}/Dockerfile"),
                "--tag", f"{PUSH_HOST}/fizzdragon/fizzdragon-{service}:{tag}",
            ]
            for key, value in sorted(arguments.items()):
                command += ["--build-arg", f"{key}={value}"]
            command += ["--label", f"com.fizzdragon.release-inputs={service_inputs(root, source, service, registry)}",
                        "--label", f"org.opencontainers.image.revision={source}"]
            print(f"Building .com {service} ({tag})", flush=True)
            subprocess.run([*command, str(context)], env=environment, check=True)
            # Save the completed image locally before contacting the registry.
            # Retry a transient push failure once without recompilation.
            reference = f"{PUSH_HOST}/fizzdragon/fizzdragon-{service}:{tag}"
            for _ in range(2):
                pushed = subprocess.run(["docker", "push", reference], env=environment, check=False)
                if pushed.returncode == 0:
                    break
            else:
                raise BuildError(f"Push failed for {service}; completed image retained locally as {reference}")
            inspected = subprocess.run(["docker", "image", "inspect", reference,
                                        "--format", "{{json .RepoDigests}}"],
                                       env=environment, capture_output=True, text=True, check=True)
            prefix = reference.rsplit(":", 1)[0] + "@"
            digests = {value[len(prefix):] for value in json.loads(inspected.stdout)
                       if value.startswith(prefix)}
            image_digest = next(iter(digests)) if len(digests) == 1 else ""
            if not isinstance(image_digest, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", image_digest):
                raise BuildError(f"Docker did not return a valid pushed digest for {service}")
            images[service] = f"{RUNTIME_HOST}/fizzdragon/fizzdragon-{service}@{image_digest}"
        return images
