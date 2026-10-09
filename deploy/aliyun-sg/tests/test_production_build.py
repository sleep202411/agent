"""Build-path regressions; Docker, Git inventory and registry metadata are simulated."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import Mock, patch

SCRIPT = Path(__file__).resolve().parents[1] / "production-build.py"
SPEC = importlib.util.spec_from_file_location("production_build", SCRIPT)
build = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build)

PUBLIC_ENV = """# Only public build configuration is admitted.
NEXT_PUBLIC_SITE_REGION=global
JAVA_STUDIO_URL=https://java.fizzdragon.com/studio
JAVA_CONTENT_URL=https://java.fizzdragon.com/content
NEXT_PUBLIC_STUDIO_HOST=studio.fizzdragon.com
NEXT_PUBLIC_OSS_BASE_URL=https://media.example.test
NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=public-fixture
SERVER_URL=http://wrong-local-host:3001
PRIVATE_KEY=must-not-be-a-build-argument
NEXT_PUBLIC_UNKNOWN_SECRET=must-not-be-a-build-argument
"""
HARNESS_FILES = {
    "apps/game-agent/src/main.ts": "readGameAgentServiceConfig();",
    "apps/game-agent/src/appearance/harness.ts": "const harness = true;",
    "apps/server/src/app.module.ts": "imports: [GameAgentModule]",
    "apps/server/src/game-agent/game-agent.config.ts": "process.env.GAME_AGENT_ENABLED",
    "apps/studio/app/[locale]/story-studio/_components/appearance-design/appearance-preview.tsx":
        'const path = "/aurora/game-agent/projects/fixture";',
    "packages/game-agent-protocol/package.json": '{"name":"@repo/game-agent-protocol"}',
}
SOURCE = "c" * 40


def archive_bytes(entries):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w") as archive:
        for name, content, mode in entries:
            entry = tarfile.TarInfo(name)
            entry.mode = mode
            if content is None:
                entry.type = tarfile.SYMTYPE
                entry.linkname = "/outside/source"
                archive.addfile(entry)
            else:
                encoded = content.encode()
                entry.size = len(encoded)
                archive.addfile(entry, io.BytesIO(encoded))
    return output.getvalue()


class FakeCommands:
    """Fail on any unexpected command rather than reaching a real executable."""
    def __init__(self, root, digest="sha256:" + "a" * 64, fail_build=None,
                 version_status=0):
        self.root, self.digest = root, digest
        self.fail_build, self.version_status = fail_build, version_status
        self.calls, self.contexts = [], []

    def __call__(self, command, **kwargs):
        self.calls.append((command, kwargs))
        if command == ["git", "symbolic-ref", "--short", "HEAD"]:
            return subprocess.CompletedProcess(command, 0, "main\n", "")
        if command == ["git", "status", "--porcelain=v1", "--untracked-files=all", "-z"]:
            return subprocess.CompletedProcess(command, 0, b"", b"")
        if command == ["git", "rev-parse", "--verify", "HEAD"]:
            return subprocess.CompletedProcess(command, 0, SOURCE + "\n", "")
        if command == ["git", "archive", "--format=tar", SOURCE]:
            files = sorted(path.relative_to(self.root).as_posix() for path in self.root.rglob("*")
                           if path.is_file() or path.is_symlink())
            entries = [(name, (self.root / name).read_text(), (self.root / name).stat().st_mode & 0o777)
                       for name in files]
            return subprocess.CompletedProcess(command, 0, archive_bytes(entries), b"")
        if command == ["docker", "info"]:
            return subprocess.CompletedProcess(command, 0, "", "")
        if command == ["docker", "buildx", "version"]:
            return subprocess.CompletedProcess(command, self.version_status, "", "")
        if command == ["docker", "context", "inspect"]:
            return subprocess.CompletedProcess(command, 0, json.dumps([
                {"Endpoints": {"docker": {"Host": "unix:///fixture/docker.sock"}}}
            ]), "")
        if command[:3] == ["docker", "buildx", "build"]:
            context = Path(command[-1])
            self.contexts.append(context)
            dockerfile = command[command.index("--file") + 1]
            service = Path(dockerfile).parent.name
            if service == self.fail_build:
                raise subprocess.CalledProcessError(1, command)
            metadata = Path(command[command.index("--metadata-file") + 1])
            metadata.write_text(json.dumps({"containerimage.digest": self.digest}))
            return subprocess.CompletedProcess(command, 0)
        if command[:2] == ["docker", "push"]:
            return subprocess.CompletedProcess(command, 0)
        if command[:3] == ["docker", "image", "inspect"]:
            repository = command[3].rsplit(":", 1)[0]
            return subprocess.CompletedProcess(command, 0, json.dumps([repository + "@" + str(self.digest)]))
        raise AssertionError(f"Unexpected executable/operation: {command}")


class ProductionBuildTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.root = self.base / "repository"
        self.root.mkdir()
        self.config = self.base / "native-docker-config"
        self.config.mkdir()
        (self.config / "config.json").write_text('{"auths":{"fixture":"fixture-token"}}')
        self.current_images = {service: f"{build.RUNTIME_HOST}/fizzdragon/fizzdragon-{service}@sha256:" + "a" * 64
                               for service in build.SERVICES}
        self.write(".dockerignore", "**/node_modules\n**/.env*\n**/dist\n")
        self.write(build.BUILD_ENV, PUBLIC_ENV)
        for relative, text in HARNESS_FILES.items():
            self.write(relative, text)
        for service in build.SERVICES:
            self.write(f"apps/{service}/Dockerfile", "FROM scratch\n")

    def write(self, relative, text):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path

    def snapshot(self, names, name="snapshot", contents=None):
        destination = self.base / name
        destination.mkdir()
        contents = contents or {}
        entries = [(name, contents.get(name, (self.root / name).read_text()),
                    (self.root / name).stat().st_mode & 0o777) for name in names]
        result = subprocess.CompletedProcess([], 0, archive_bytes(entries))
        with patch.object(build.subprocess, "run", return_value=result) as run:
            digest = build.source_snapshot(self.root, destination, SOURCE)
        self.assertEqual(run.call_args.args[0],
                         ["git", "archive", "--format=tar", SOURCE])
        self.assertEqual(run.call_args.kwargs["cwd"], self.root.resolve())
        return destination, digest

    def run_build(self, services, commands=None, npm_registry=None):
        commands = commands or FakeCommands(self.root)
        output = io.StringIO()
        with patch.object(build, "find_reusable_image", return_value=None), \
                patch.object(build, "service_inputs", return_value="f" * 64), \
                patch.object(build.subprocess, "run", side_effect=commands), \
                patch.dict(os.environ, {"DOCKER_CONTEXT": "desktop-linux",
                                        "DOCKER_HOST": "tcp://must-not-use.invalid:2375",
                                        "DOCKER_CONFIG": str(self.config),
                                        "BUILDX_BUILDER": "old-named-remote-builder",
                                        "BUILDX_CONFIG": "/never-copy-existing-builder-settings",
                                        "BUILDKIT_HOST": "tcp://other-builder.invalid:1234"}), \
                contextlib.redirect_stdout(output):
            images = build.build_images(self.root, services, self.current_images, npm_registry=npm_registry)
        return images, commands, output.getvalue()

    def test_all_reused_skips_compilation_and_publication(self):
        commands = FakeCommands(self.root)
        with patch.object(build, 'find_reusable_image', return_value='verified@sha256:digest'), \
                patch.object(build.subprocess, 'run', side_effect=commands):
            self.assertEqual(build.build_images(self.root, ['web'], self.current_images, source=SOURCE),
                             {'web': 'verified@sha256:digest'})
        self.assertTrue(all(c[0] == 'docker' and 'build' not in c and 'push' not in c
                            for c, _ in commands.calls))

    def test_opt_in_npm_registry_is_passed_only_when_requested(self):
        mirror = "https://registry.npmmirror.com"
        images, commands, _ = self.run_build(["admin-ui", "server"], npm_registry=mirror)
        self.assertEqual(set(images), {"admin-ui", "server"})
        builds = [cmd for cmd, _ in commands.calls if cmd[:3] == ["docker", "buildx", "build"]]
        self.assertEqual(len(builds), 2)
        for cmd in builds:
            arguments = dict(cmd[index + 1].split("=", 1) for index, value in enumerate(cmd)
                             if value == "--build-arg")
            self.assertEqual(arguments.get("NPM_REGISTRY"), mirror)
        with self.assertRaisesRegex(build.BuildError, "https URL"):
            build.optional_npm_registry("http://insecure.example/npm")

    def test_npm_registry_override_participates_in_reuse_identity(self):
        identity = Mock()
        identity.inputs.return_value = "f" * 64
        spec = Mock()
        with patch.object(build.importlib.util, "spec_from_file_location", return_value=spec), \
                patch.object(build.importlib.util, "module_from_spec", return_value=identity):
            default = build.service_inputs(self.root, SOURCE, "web")
            first = build.service_inputs(self.root, SOURCE, "web", "https://registry.npmmirror.com")
            second = build.service_inputs(self.root, SOURCE, "web", "https://registry.npmjs.org")
        self.assertEqual(default, "f" * 64)
        self.assertEqual(len({default, first, second}), 3)

    def test_partial_reuse_builds_only_missing_service(self):
        commands = FakeCommands(self.root)
        with patch.object(build, 'find_reusable_image', side_effect=['verified-image', None]), \
                patch.object(build, 'service_inputs', return_value='f' * 64), \
                patch.object(build.subprocess, 'run', side_effect=commands):
            images = build.build_images(self.root, ['web', 'admin-ui'], self.current_images, source=SOURCE)
        self.assertEqual(images['web'], 'verified-image')
        builds = [c for c, _ in commands.calls if c[:3] == ['docker', 'buildx', 'build']]
        self.assertEqual(len(builds), 1)
        self.assertIn('admin-ui/Dockerfile', builds[0][builds[0].index('--file') + 1])

    def test_persistent_push_failure_stops_after_two_attempts(self):
        commands = FakeCommands(self.root)
        pushes = []
        def execute(command, **kwargs):
            if command[:2] == ['docker', 'push']:
                pushes.append(command)
                return subprocess.CompletedProcess(command, 1)
            return commands(command, **kwargs)
        with self.assertRaisesRegex(build.BuildError, 'completed image retained locally'):
            self.run_build(['web'], execute)
        self.assertEqual(len(pushes), 2)
        self.assertEqual(sum(c[:3] == ['docker', 'buildx', 'build'] for c, _ in commands.calls), 1)
        self.assert_cleaned(commands)

    def test_failed_push_retries_without_rebuilding(self):
        commands = FakeCommands(self.root)
        pushes = []
        def execute(command, **kwargs):
            if command[:2] == ['docker', 'push']:
                pushes.append(command)
                return subprocess.CompletedProcess(command, 1 if len(pushes) == 1 else 0)
            return commands(command, **kwargs)
        self.run_build(['web'], execute)
        self.assertEqual(len(pushes), 2)
        self.assertEqual(sum(c[:3] == ['docker', 'buildx', 'build'] for c, _ in commands.calls), 1)

    def assert_cleaned(self, commands):
        for context in commands.contexts:
            self.assertFalse(context.exists())
        self.assertEqual((self.config / "config.json").read_text(),
                         '{"auths":{"fixture":"fixture-token"}}')

    def test_clean_main_is_pinned_without_fetching_or_modifying_git(self):
        results = [subprocess.CompletedProcess([], 0, "main\n", ""),
                   subprocess.CompletedProcess([], 0, b"", b""),
                   subprocess.CompletedProcess([], 0, SOURCE + "\n", "")]
        with patch.object(build.subprocess, "run", side_effect=results) as commands:
            self.assertEqual(build.committed_source(self.root), SOURCE)
        self.assertEqual([call.args[0] for call in commands.call_args_list], [
            ["git", "symbolic-ref", "--short", "HEAD"],
            ["git", "status", "--porcelain=v1", "--untracked-files=all", "-z"],
            ["git", "rev-parse", "--verify", "HEAD"],
        ])
        self.assertTrue(all(call.kwargs["cwd"] == self.root for call in commands.call_args_list))

    def test_wrong_branch_or_any_dirty_source_stops_before_docker_and_cloud(self):
        cases = [([subprocess.CompletedProcess([], 0, "develop\n", "")], "main branch"),
                 ([subprocess.CompletedProcess([], 0, "main\n", ""),
                   subprocess.CompletedProcess([], 0, b" M apps/server/source.ts\0", b"")], "clean main"),
                 ([subprocess.CompletedProcess([], 0, "main\n", ""),
                   subprocess.CompletedProcess([], 0, b"?? untracked-feature.ts\0", b"")], "clean main")]
        for results, message in cases:
            with self.subTest(message=message), patch.object(build.subprocess, "run", side_effect=results) as commands:
                with self.assertRaisesRegex(build.BuildError, message):
                    build.build_images(self.root, ["web"], self.current_images)
                self.assertTrue(all(call.args[0][0] == "git" for call in commands.call_args_list))

    def test_explicit_pinned_revision_does_not_reread_a_later_checkout_head(self):
        commands = FakeCommands(self.root)
        with patch.object(build, "find_reusable_image", return_value=None), \
                patch.object(build, "service_inputs", return_value="f" * 64), \
                patch.object(build.subprocess, "run", side_effect=commands), \
                contextlib.redirect_stdout(io.StringIO()):
            build.build_images(self.root, ["web"], self.current_images, source=SOURCE)
        git_calls = [command for command, _ in commands.calls if command[0] == "git"]
        self.assertEqual(git_calls, [["git", "archive", "--format=tar", SOURCE]])
        self.assert_cleaned(commands)

    def test_snapshot_uses_committed_bytes_and_excludes_untracked_working_tree_source(self):
        self.write("tracked.ts", "current working-tree change")
        untracked = "apps/game-agent/src/appearance/untracked-feature.ts"
        self.write(untracked, "new Harness functionality")
        names = [".dockerignore", "tracked.ts", *HARNESS_FILES, "apps/game-agent/Dockerfile"]
        destination, source = self.snapshot(names, contents={"tracked.ts": "committed contents"})
        self.assertEqual((destination / "tracked.ts").read_text(), "committed contents")
        self.assertFalse((destination / untracked).exists())
        self.assertEqual((destination / ".dockerignore").read_bytes(),
                         (self.root / ".dockerignore").read_bytes())
        self.assertEqual(source, SOURCE)
        build.require_harness_source(destination, ["server", "studio", "game-agent"])

    def test_snapshot_excludes_every_local_env_except_com_public_config(self):
        local = [".env", ".env.local", ".env.example", "apps/server/.env.production",
                 "apps/web/.env.production.cn", "apps/studio/.env.local"]
        for name in local:
            self.write(name, "PRIVATE_FIXTURE=never-copy")
        destination, _ = self.snapshot([".dockerignore", build.BUILD_ENV, *local])
        self.assertTrue((destination / build.BUILD_ENV).exists())
        self.assertTrue(all(not (destination / name).exists() for name in local))

    def test_snapshot_preserves_committed_executable_mode_and_full_source_revision(self):
        file = self.write("source.sh", "#!/bin/sh\n")
        file.chmod(0o755)
        destination, source = self.snapshot([".dockerignore", "source.sh"])
        self.assertEqual(source, SOURCE)
        self.assertEqual((destination / "source.sh").stat().st_mode & 0o777, 0o755)

    def test_snapshot_rejects_archived_symlinks(self):
        destination = self.base / "symlink-snapshot"; destination.mkdir()
        result = subprocess.CompletedProcess([], 0, archive_bytes([("link.ts", None, 0o777)]))
        with patch.object(build.subprocess, "run", return_value=result):
            with self.assertRaisesRegex(ValueError, "Unsupported source"):
                build.source_snapshot(self.root, destination, SOURCE)

    def test_snapshot_rejects_absolute_and_parent_paths(self):
        for index, name in enumerate(["../outside.ts", "/absolute/source.ts"]):
            destination = self.base / f"path-{index}"; destination.mkdir()
            result = subprocess.CompletedProcess([], 0, archive_bytes([(name, "unsafe", 0o644)]))
            with patch.object(build.subprocess, "run", return_value=result):
                with self.subTest(name=name), self.assertRaisesRegex(ValueError, "unsafe source path"):
                    build.source_snapshot(self.root, destination, SOURCE)

    def test_snapshot_rejects_destination_inside_repository_or_redirected_child(self):
        with self.assertRaisesRegex(ValueError, "outside the working tree"):
            build.source_snapshot(self.root, self.root / "nested-build", SOURCE)
        destination = self.base / "destination"
        destination.mkdir()
        outside = self.base / "outside-destination"
        outside.mkdir()
        (destination / "apps").symlink_to(outside, target_is_directory=True)
        result = subprocess.CompletedProcess([], 0, archive_bytes([
            (".dockerignore", "", 0o644), (build.BUILD_ENV, PUBLIC_ENV, 0o644)]))
        with patch.object(build.subprocess, "run", return_value=result):
            with self.assertRaisesRegex(ValueError, "unsafe path"):
                build.source_snapshot(self.root, destination, SOURCE)
        self.assertFalse((outside / "web/.env.production.com").exists())

    def test_build_env_is_a_public_allowlist_and_never_evaluates_shell_syntax(self):
        marker = self.base / "must-not-exist"
        env = self.write(build.BUILD_ENV, PUBLIC_ENV +
                         f'NEXT_PUBLIC_BANNER_BASE_URL="$(touch {marker})"\n')
        parsed = build.parse_build_env(env)
        self.assertNotIn("PRIVATE_KEY", parsed)
        self.assertNotIn("NEXT_PUBLIC_UNKNOWN_SECRET", parsed)
        self.assertNotIn("SERVER_URL", parsed)
        self.assertEqual(parsed["NEXT_PUBLIC_BANNER_BASE_URL"], f"$(touch {marker})")
        self.assertFalse(marker.exists())

    def test_cn_region_and_wrong_java_hosts_are_rejected(self):
        for old, new in [("SITE_REGION=global", "SITE_REGION=cn"),
                         ("https://java.fizzdragon.com/studio", "https://java.fizzspace.cn/studio"),
                         ("https://java.fizzdragon.com/content", "https://other.test/content")]:
            with self.subTest(new=new):
                env = self.write(build.BUILD_ENV, PUBLIC_ENV.replace(old, new))
                with self.assertRaisesRegex(ValueError, "The .com build requires"):
                    build.parse_build_env(env)

    def test_all_six_builds_return_vpc_digests_and_service_specific_public_arguments(self):
        services = ["web", "studio", "admin-ui", "server", "agent-os", "game-agent"]
        images, commands, _ = self.run_build(services)
        self.assertEqual(set(images), set(services))
        builds = [(cmd, kw) for cmd, kw in commands.calls if cmd[:3] == ["docker", "buildx", "build"]]
        self.assertEqual(len(builds), 6)
        for service, (cmd, kw) in zip(services, builds):
            self.assertEqual(images[service],
                             f"{build.RUNTIME_HOST}/fizzdragon/fizzdragon-{service}@{commands.digest}")
            self.assertEqual(cmd[cmd.index("--platform") + 1], "linux/amd64")
            self.assertEqual(cmd[cmd.index("--builder") + 1], "default")
            self.assertIn("--load", cmd)
            self.assertIn("--provenance=false", cmd)
            self.assertIn("--progress=plain", cmd)
            self.assertRegex(cmd[cmd.index("--tag") + 1],
                             rf"^{re.escape(build.PUSH_HOST)}/fizzdragon/fizzdragon-{service}:{SOURCE}$")
            self.assertTrue(cmd[cmd.index("--file") + 1].endswith(f"apps/{service}/Dockerfile"))
            arguments = dict(cmd[index + 1].split("=", 1) for index, value in enumerate(cmd)
                             if value == "--build-arg")
            if service == "web":
                self.assertEqual(arguments["SERVER_URL"], "http://fizzdragon-server:3001")
                self.assertEqual(arguments["NEXT_PUBLIC_SITE_REGION"], "global")
                self.assertEqual(arguments["NEXT_PUBLIC_STUDIO_HOST"], "studio.fizzdragon.com")
                self.assertEqual(arguments["JAVA_STUDIO_URL"], "https://java.fizzdragon.com/studio")
                self.assertNotIn("PRIVATE_KEY", arguments)
                self.assertNotIn("NEXT_PUBLIC_UNKNOWN_SECRET", arguments)
            elif service == "studio":
                self.assertEqual(arguments, {"JAVA_STUDIO_URL": "https://java.fizzdragon.com/studio",
                    "JAVA_CONTENT_URL": "https://java.fizzdragon.com/content", "NEXT_PUBLIC_SITE_REGION": "global",
                    "AURORA_PROXY_TARGET": "http://fizzdragon-server:3001", "AURORA_STRIP_PREFIX": "1"})
            elif service == "admin-ui":
                self.assertEqual(arguments, {"NEXT_PUBLIC_ADMIN_UI_BASE_PATH": "/"})
            else:
                self.assertEqual(arguments, {})
            self.assertEqual(kw["env"]["DOCKER_HOST"], "unix:///fixture/docker.sock")
            self.assertNotIn("DOCKER_CONTEXT", kw["env"])
            self.assertNotIn("BUILDX_BUILDER", kw["env"])
            self.assertNotIn("BUILDX_CONFIG", kw["env"])
            self.assertNotIn("BUILDKIT_HOST", kw["env"])
            labels = dict(cmd[i + 1].split("=", 1) for i, flag in enumerate(cmd) if flag == "--label")
            self.assertEqual(labels["com.fizzdragon.release-inputs"], "f" * 64)
            self.assertEqual(labels["org.opencontainers.image.revision"], SOURCE)
            self.assertEqual(kw["env"]["DOCKER_CONFIG"], str(self.config))
        self.assert_cleaned(commands)

    def test_native_registry_credentials_are_preserved_without_reading_or_printing_them(self):
        _, commands, output = self.run_build(["web"])
        self.assertFalse(any(cmd[:2] == ["docker", "login"] or cmd[0] == "aliyun"
                             for cmd, _ in commands.calls))
        self.assertNotIn("fixture-token", output)
        self.assert_cleaned(commands)

    def test_unavailable_buildx_stops_before_compilation(self):
        commands = FakeCommands(self.root, version_status=1)
        with self.assertRaisesRegex(build.BuildError, "available in the managed job"):
            self.run_build(["web"], commands)
        self.assertFalse(commands.contexts)
        self.assert_cleaned(commands)

    def test_remote_daemon_is_rejected(self):
        for host in ("tcp://remote.invalid:2375", "tcp://user:password@localhost:2375",
                     "tcp://localhost:2375/path", "tcp://localhost:2375?credential=bad",
                     "tcp://localhost:2375#fragment", "tcp://localhost:invalid",
                     "tcp://localhost:80"):
            with self.subTest(host=host), \
                    patch.dict(os.environ, {"DOCKER_HOST": host}, clear=True), \
                    patch.object(build.subprocess, "run") as run:
                with self.assertRaisesRegex(build.BuildError, "job-local Docker daemon"):
                    build.docker_environment()
                run.assert_not_called()

    def test_managed_loopback_daemon_preserves_native_registry_login(self):
        for host in ("tcp://localhost:2375", "tcp://127.0.0.1:2375", "tcp://[::1]:2376"):
            with self.subTest(host=host), \
                    patch.dict(os.environ, {"DOCKER_HOST": host, "DOCKER_CONFIG": str(self.config)}, clear=True), \
                    patch.object(build.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as run:
                environment = build.docker_environment()
                self.assertEqual(environment["DOCKER_HOST"], host)
                self.assertEqual(environment["DOCKER_CONFIG"], str(self.config))
                self.assertEqual([call.args[0] for call in run.call_args_list],
                                 [["docker", "info"], ["docker", "buildx", "version"]])

    def test_invalid_digest_fails_without_a_release_and_cleans_credentials(self):
        for invalid in ["", "sha256:short", "sha256:" + "A" * 64, None, {"bad": "value"}]:
            with self.subTest(digest=invalid):
                commands = FakeCommands(self.root, digest=invalid)
                with self.assertRaisesRegex(RuntimeError, "valid pushed digest"):
                    self.run_build(["web"], commands)
                self.assert_cleaned(commands)

    def test_build_failure_returns_no_partial_release_and_cleans_credentials(self):
        commands = FakeCommands(self.root, fail_build="studio")
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_build(["web", "studio"], commands)
        self.assertEqual(len(commands.contexts), 2)
        self.assert_cleaned(commands)

    def test_missing_harness_integration_stops_before_compilation(self):
        (self.root / "apps/server/src/app.module.ts").write_text("imports: []")
        for service in ["server", "studio", "game-agent"]:
            with self.subTest(service=service), self.assertRaisesRegex(ValueError, "Harness integration"):
                self.run_build([service])

    def test_legacy_empty_duplicate_and_unknown_services_stop_before_commands(self):
        for services in [["agent"], [], ["web", "web"], ["unknown"]]:
            with self.subTest(services=services), patch.object(build.subprocess, "run") as run:
                with self.assertRaises(ValueError):
                    build.build_images(self.root, services, self.current_images)
                run.assert_not_called()


class RegistryReuseTests(unittest.TestCase):
    def setUp(self):
        self.image = f"{build.RUNTIME_HOST}/fizzdragon/fizzdragon-web@sha256:" + 'a' * 64
        self.labels = {'com.fizzdragon.release-inputs': 'f' * 64,
                       'org.opencontainers.image.revision': SOURCE}

    def lookup(self, config=None, status=0, ancestry=0, fingerprint='f' * 64, image=None):
        config = config if config is not None else {'os': 'linux', 'architecture': 'amd64',
                                                   'config': {'Labels': self.labels}}
        results = [subprocess.CompletedProcess([], status, json.dumps(config), 'private-token'),
                   subprocess.CompletedProcess([], ancestry)]
        with patch.object(build, 'service_inputs', return_value=fingerprint), \
                patch.object(build.subprocess, 'run', side_effect=results) as commands, \
                contextlib.redirect_stdout(io.StringIO()):
            result = build.find_reusable_image(Path('/fixture'), SOURCE, 'web', image or self.image,
                                               {'DOCKER_CONFIG': '/native/job/config'})
        return result, commands

    def test_matching_ancestor_image_reuses_exact_running_digest(self):
        image, commands = self.lookup()
        self.assertEqual(image, self.image)
        self.assertEqual(commands.call_args_list[0].args[0][4], self.image)
        self.assertEqual(commands.call_args_list[1].args[0],
                         ['git', '-C', '/fixture', 'merge-base', '--is-ancestor', SOURCE, SOURCE])

    def test_changed_inputs_or_nonancestor_require_a_build(self):
        self.assertIsNone(self.lookup(fingerprint='e' * 64)[0])
        self.assertIsNone(self.lookup(ancestry=1)[0])

    def test_legacy_unlabelled_image_builds_once(self):
        self.labels.clear()
        self.assertIsNone(self.lookup()[0])

    def test_registry_failure_is_not_a_cache_miss_and_hides_output(self):
        with self.assertRaisesRegex(build.BuildError, 'native ACR login') as error:
            self.lookup(status=1)
        self.assertNotIn('private-token', str(error.exception))

    def test_malformed_or_untrusted_image_metadata_fails_closed(self):
        for config in [[], {}, {'os': 'linux', 'architecture': 'arm64'},
                       {'os': 'linux', 'architecture': 'amd64', 'config': []},
                       {'os': 'linux', 'architecture': 'amd64', 'config': {'Labels': []}},
                       {'os': 'linux', 'architecture': 'amd64', 'config': {'Labels': ''}}]:
            with self.subTest(config=config), self.assertRaises(build.BuildError):
                self.lookup(config=config)
        for key in self.labels:
            with self.subTest(key=key):
                saved = self.labels[key]
                self.labels[key] = 'invalid'
                with self.assertRaises(build.BuildError): self.lookup()
                self.labels[key] = saved
        with self.assertRaises(build.BuildError): self.lookup(ancestry=128)

    def test_other_repository_mutable_tag_or_service_is_rejected_before_registry_access(self):
        for image in ['other.test/fizzdragon/web@sha256:' + 'a' * 64,
                      self.image.replace('fizzdragon-web', 'fizzdragon-server'),
                      self.image.split('@')[0] + ':main']:
            with self.subTest(image=image), patch.object(build.subprocess, 'run') as run:
                with self.assertRaises(build.BuildError):
                    build.find_reusable_image(Path('/fixture'), SOURCE, 'web', image, {})
                run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
