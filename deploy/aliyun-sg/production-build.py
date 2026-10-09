#!/usr/bin/env python3
"""Build explicitly selected .com images after the caller verifies the SG target.

Uses local Docker only; never starts/prunes it or changes Git/cloud workloads.
Source tags identify a committed, clean main revision. Docker applies the
archived repository's .dockerignore; local edits never enter the build context.
"""
import io
import importlib.util
import json
import os
from pathlib import Path
import re
from shutil import copyfileobj
import subprocess
import tarfile
import tempfile

INSTANCE_ID = "cri-d97629cirhkt3p9e"
PUSH_HOST = "fizzdragon-com-sg-registry.ap-southeast-1.cr.aliyuncs.com"
RUNTIME_HOST = "fizzdragon-com-sg-registry-vpc.ap-southeast-1.cr.aliyuncs.com"
SERVICES = {"web", "server", "studio", "admin-ui", "agent-os", "game-agent"}
BUILD_ENV = "apps/web/.env.production.com"


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


def parse_build_env(path: Path) -> dict[str, str]:
    """Read approved public/.com URLs as data, never as shell instructions."""
    allowed = PUBLIC_ARGS | {"JAVA_STUDIO_URL", "JAVA_CONTENT_URL"}
    result = {}
    for line in path.read_text().splitlines():
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
        if not path.is_file() or marker not in path.read_text():
            raise ValueError(f"Current Harness integration is missing: {relative}")
    for relative in ("apps/game-agent/Dockerfile", "packages/game-agent-protocol/package.json"):
        if not (context / relative).is_file():
            raise ValueError(f"Current Harness source is missing: {relative}")


def docker_environment(config: Path, plugins) -> dict[str, str]:
    """Keep the existing local daemon while isolating registry login credentials."""
    environment = dict(os.environ)
    host = environment.get("DOCKER_HOST", "")
    if not host or environment.get("DOCKER_CONTEXT"):
        inspected = subprocess.run(
            ["docker", "context", "inspect"], capture_output=True, text=True, check=False,
        )
        try:
            host = json.loads(inspected.stdout)[0]["Endpoints"]["docker"]["Host"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise BuildError("Cannot resolve the current local Docker daemon") from None
        if inspected.returncode:
            raise BuildError("Cannot inspect the current Docker context")
    if not isinstance(host, str) or not host.startswith(("unix://", "npipe://")):
        raise BuildError("The .com image builder requires an existing local Docker daemon")
    try:
        candidates = [plugin["Path"] for plugin in plugins if plugin.get("Name") == "buildx"]
        if len(candidates) != 1 or not isinstance(candidates[0], str):
            raise ValueError()
        executable = Path(candidates[0]).resolve(strict=True)
        if not executable.is_file() or not os.access(executable, os.X_OK):
            raise ValueError()
    except (OSError, KeyError, TypeError, AttributeError, ValueError):
        raise BuildError("Cannot locate the existing executable Docker buildx plugin") from None
    plugin_directory = config / "cli-plugins"
    plugin_directory.mkdir(mode=0o700)
    (plugin_directory / "docker-buildx").symlink_to(executable)
    for key in ("DOCKER_CONTEXT", "BUILDX_BUILDER", "BUILDX_CONFIG", "BUILDKIT_HOST"):
        environment.pop(key, None)
    environment.update(DOCKER_HOST=host, DOCKER_CONFIG=str(config))
    checked = subprocess.run(["docker", "buildx", "version"], env=environment,
                             capture_output=True, check=False)
    if checked.returncode:
        raise BuildError("Docker buildx is unavailable in the isolated build configuration")
    return environment


def registry_login(cloud, environment):
    auth = cloud("cr", "GetAuthorizationToken", "--InstanceId", INSTANCE_ID)
    username, token = auth.get("TempUsername"), auth.get("AuthorizationToken")
    if (auth.get("IsSuccess") is not True or not isinstance(username, str)
            or not username or not isinstance(token, str) or not token):
        raise BuildError("Singapore registry authorization failed")
    login = subprocess.run(
        ["docker", "login", PUSH_HOST, "--username", username, "--password-stdin"],
        input=token + "\n", text=True, capture_output=True, env=environment, check=False,
    )
    del auth, token
    if login.returncode:
        raise BuildError("Singapore registry Docker login failed")


def service_inputs(root, source, service):
    spec = importlib.util.spec_from_file_location(
        "sg_release_inputs", Path(__file__).resolve().parents[1] / "release_inputs.py")
    identity = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(identity)
    return identity.inputs(root, source, service, "com")


def find_reusable_image(root, source, service, cloud):
    """Fail closed on registry errors; reuse only verified ancestor inputs."""
    expected = service_inputs(root, source, service)

    def query(action, **parameters):
        args = ["cr", action, "--InstanceId", INSTANCE_ID]
        for key, value in parameters.items():
            args += ["--" + key, str(value)]
        result = cloud(*args)
        if result.get("IsSuccess") is not True or result.get("Code") != "success":
            raise BuildError("Singapore registry lookup failed; refusing fallback build")
        return result

    name = f"fizzdragon-{service}"
    listing = query("ListRepository", RepoNamespaceName="fizzdragon", RepoName=name)
    rows = listing.get("Repositories", [])
    if listing.get("TotalCount") != 1 or len(rows) != 1:
        raise BuildError("Singapore image repository cannot be uniquely verified")
    repo = rows[0]
    if (repo.get("RepoName") != name or repo.get("RepoNamespaceName") != "fizzdragon"
            or repo.get("InstanceId") != INSTANCE_ID or repo.get("RepoStatus") != "NORMAL"):
        raise BuildError("Singapore image repository identity mismatch")
    page = 1
    all_rows = []
    while True:
        listing = query("ListRepoTag", RepoId=repo["RepoId"], PageNo=page, PageSize=100)
        rows = listing.get("Images")
        total = listing.get("TotalCount")
        if not isinstance(rows, list) or not isinstance(total, int) or total < 0:
            raise BuildError("Invalid Singapore image listing")
        all_rows.extend(rows)
        if page * 100 >= total:
            break
        if not rows:
            raise BuildError("Incomplete Singapore image listing")
        page += 1
    spec = importlib.util.spec_from_file_location(
        "sg_release_order", Path(__file__).resolve().parents[1] / "release_inputs.py")
    identity = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(identity)
    for _, row in identity.newest_first(root, source, [(row.get("Tag", ""), row) for row in all_rows]):
        tag = row.get("Tag", "")
        digest = row.get("Digest", "")
        digest = digest if digest.startswith("sha256:") else "sha256:" + digest
        if (row.get("Status") != "NORMAL" or not re.fullmatch(r"[0-9a-f]{40}", tag)
                or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest)):
            continue
        ancestry = subprocess.run(["git", "-C", str(root), "merge-base", "--is-ancestor", tag, source],
                                  capture_output=True)
        if ancestry.returncode:
            continue
        # Registry history can predate this deployment system. Such images
        # have no comparable recipe and cannot establish safe reuse.
        recipe = subprocess.run(
            ["git", "-C", str(root), "ls-tree", "--name-only", tag, "--",
             "deploy/aliyun-sg/production-build.py"],
            capture_output=True, text=True, check=True)
        if not recipe.stdout.strip():
            continue
        if service_inputs(root, tag, service) != expected:
            continue
        verified = query("GetRepoTag", RepoId=repo["RepoId"], Tag=tag)
        current = verified.get("Digest", "")
        current = current if current.startswith("sha256:") else "sha256:" + current
        if verified.get("Tag") != tag or verified.get("Status") != "NORMAL" or current != digest:
            raise BuildError("Singapore image changed during reuse verification")
        print(f"Reusing .com {service}:{tag} ({digest}); no build", flush=True)
        return f"{RUNTIME_HOST}/fizzdragon/fizzdragon-{service}@{digest}"
    return None


def build_images(root: Path, services: list[str], cloud, source=None) -> dict[str, str]:
    """Push all selected amd64 images; return exact VPC runtime digest references."""
    if not services or len(set(services)) != len(services) or not set(services) <= SERVICES:
        raise ValueError("Select unique services: web server studio admin-ui agent-os game-agent")
    source = source or committed_source(root)
    images = {}
    missing = []
    for service in services:
        existing = find_reusable_image(root, source, service, cloud)
        if existing:
            images[service] = existing
        else:
            missing.append(service)
    if not missing:
        return images
    services = missing
    checked = subprocess.run(["docker", "info", "--format", "{{json .ClientInfo.Plugins}}"],
                             capture_output=True, text=True, check=False)
    if checked.returncode:
        raise BuildError("Docker must already be running and available")
    try:
        plugins = json.loads(checked.stdout)
        if not isinstance(plugins, list):
            raise ValueError()
    except (ValueError, TypeError):
        raise BuildError("Docker returned invalid local plugin metadata") from None
    with tempfile.TemporaryDirectory(prefix="fizzdragon-com-build-") as directory:
        temporary = Path(directory)
        context, config = temporary / "source", temporary / "docker-config"
        context.mkdir()
        config.mkdir(mode=0o700)
        tag = source_snapshot(root, context, source)
        require_harness_source(context, services)
        public = parse_build_env(context / BUILD_ENV)
        environment = docker_environment(config, plugins)
        registry_login(cloud, environment)
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
            metadata = temporary / f"{service}-metadata.json"
            command = [
                "docker", "buildx", "build", "--builder", "default", "--platform", "linux/amd64", "--load",
                "--provenance=false", "--metadata-file", str(metadata), "--progress=plain",
                "--file", str(context / f"apps/{service}/Dockerfile"),
                "--tag", f"{PUSH_HOST}/fizzdragon/fizzdragon-{service}:{tag}",
            ]
            for key, value in sorted(arguments.items()):
                command += ["--build-arg", f"{key}={value}"]
            print(f"Building .com {service} ({tag})", flush=True)
            subprocess.run([*command, str(context)], env=environment, check=True)
            # Save the completed image locally before contacting the registry.
            # Refresh credentials after compilation, and retry only the push.
            reference = f"{PUSH_HOST}/fizzdragon/fizzdragon-{service}:{tag}"
            for attempt in range(2):
                registry_login(cloud, environment)
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
