"""Build-path regressions; Docker, Git inventory and cloud APIs are simulated."""
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
    def __init__(self, root, digest="sha256:" + "a" * 64, login_status=0, fail_build=None,
                 isolated_version_status=0, plugins=None):
        self.root, self.digest = root, digest
        self.login_status, self.fail_build = login_status, fail_build
        self.isolated_version_status = isolated_version_status
        self.plugins = plugins if plugins is not None else [
            {"Name": "buildx", "Path": str(root.parent / "docker-buildx")},
        ]
        self.calls, self.configs, self.contexts = [], [], []
        self.plugin_links, self.isolated_configs = [], []

    def __call__(self, command, **kwargs):
        self.calls.append((command, kwargs))
        if command == ["git", "symbolic-ref", "--short", "HEAD"]:
            return subprocess.CompletedProcess(command, 0, "main\n", "")
        if command == ["git", "status", "--porcelain=v1", "--untracked-files=all", "-z"]:
            return subprocess.CompletedProcess(command, 0, b"", b"")
        if command == ["git", "rev-parse", "--verify", "HEAD"]:
            return subprocess.CompletedProcess(command, 0, SOURCE + "\n", "")
        if command[:2] == ["git", "fetch"]:
            return subprocess.CompletedProcess(command, 0, "", "")
        if command == ["git", "rev-parse", "refs/remotes/origin/main"]:
            return subprocess.CompletedProcess(command, 0, SOURCE + "\n", "")
        if command == ["git", "archive", "--format=tar", SOURCE]:
            files = sorted(path.relative_to(self.root).as_posix() for path in self.root.rglob("*")
                           if path.is_file() or path.is_symlink())
            entries = [(name, (self.root / name).read_text(), (self.root / name).stat().st_mode & 0o777)
                       for name in files]
            return subprocess.CompletedProcess(command, 0, archive_bytes(entries), b"")
        if command == ["docker", "info", "--format", "{{json .ClientInfo.Plugins}}"]:
            return subprocess.CompletedProcess(command, 0, json.dumps(self.plugins), "")
        if command == ["docker", "buildx", "version"]:
            config = Path(kwargs["env"]["DOCKER_CONFIG"])
            candidates = [config / "cli-plugins/docker-buildx",
                          config / "cli-plugins/docker-buildx.exe"]
            plugin = next((path for path in candidates if path.exists()), candidates[0])
            self.plugin_links.append((plugin, plugin.resolve(), plugin.is_symlink()))
            self.isolated_configs.append(config)
            # Symlink when permitted; Windows without privilege falls back to a copied plugin.
            if not plugin.exists() or not os.access(plugin, os.X_OK):
                raise AssertionError("Isolated Docker configuration lost its buildx plugin")
            if (config / "config.json").exists():
                raise AssertionError("Existing Docker auth/config must not be copied")
            return subprocess.CompletedProcess(command, self.isolated_version_status, "", "")
        if command == ["docker", "context", "inspect"]:
            return subprocess.CompletedProcess(command, 0, json.dumps([
                {"Endpoints": {"docker": {"Host": "unix:///fixture/docker.sock"}}}
            ]), "")
        if command[:2] == ["docker", "login"]:
            config = Path(kwargs["env"]["DOCKER_CONFIG"])
            self.configs.append(config)
            # Simulate the real CLI's persisted login, then verify its cleanup.
            (config / "config.json").write_text('{"auths":{"fixture":"fixture-token"}}')
            return subprocess.CompletedProcess(command, self.login_status, "", "fixture-token")
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
        self.plugin = self.base / "docker-buildx"
        self.plugin.write_text("fixture plugin; never executed")
        self.plugin.chmod(0o700)
        self.write(".dockerignore", "**/node_modules\n**/.env*\n**/dist\n")
        self.write(build.BUILD_ENV, PUBLIC_ENV)
        for relative, text in HARNESS_FILES.items():
            self.write(relative, text)
        for service in build.SERVICES:
            self.write(f"apps/{service}/Dockerfile", "FROM scratch\n")
        self.cloud = Mock(return_value={"IsSuccess": True, "TempUsername": "fixture-user",
                                       "AuthorizationToken": "fixture-token"})

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
                patch.object(build.subprocess, "run", side_effect=commands), \
                patch.dict(os.environ, {"DOCKER_CONTEXT": "desktop-linux",
                                        "DOCKER_HOST": "tcp://must-not-use.invalid:2375",
                                        "BUILDX_BUILDER": "old-named-remote-builder",
                                        "BUILDX_CONFIG": "/never-copy-existing-builder-settings",
                                        "BUILDKIT_HOST": "tcp://other-builder.invalid:1234"},
                           clear=False), \
                contextlib.redirect_stdout(output):
            images = build.build_images(self.root, services, self.cloud, npm_registry=npm_registry)
        return images, commands, output.getvalue()

    def test_stale_local_main_is_rejected_before_build(self):
        commands = FakeCommands(self.root)
        def execute(command, **kwargs):
            if command == ['git', 'rev-parse', 'refs/remotes/origin/main']:
                return subprocess.CompletedProcess(command, 0, 'd' * 40 + '\n', '')
            return commands(command, **kwargs)
        with patch.object(build.subprocess, 'run', side_effect=execute), \
                self.assertRaisesRegex(build.BuildError, 'differs from freshly fetched'):
            build.committed_source(self.root)
        self.assertFalse(any(c[:2] == ['docker', 'login'] for c, _ in commands.calls))

    def test_all_reused_skips_docker_entirely(self):
        with patch.object(build, 'find_reusable_image', return_value='verified@sha256:digest'), \
                patch.object(build.subprocess, 'run') as run:
            self.assertEqual(build.build_images(self.root, ['web'], self.cloud, source=SOURCE),
                             {'web': 'verified@sha256:digest'})
            run.assert_not_called()

    def test_partial_reuse_builds_only_missing_service(self):
        commands = FakeCommands(self.root)
        with patch.object(build, 'find_reusable_image', side_effect=['verified-image', None]), \
                patch.object(build.subprocess, 'run', side_effect=commands):
            images = build.build_images(self.root, ['web', 'admin-ui'], self.cloud, source=SOURCE)
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
        self.assertEqual(self.cloud.call_count, 3)

    def assert_cleaned(self, commands):
        self.assertTrue(commands.isolated_configs)
        for config in commands.configs + commands.isolated_configs:
            self.assertFalse(config.exists())
            self.assertFalse(config.parent.exists())
        for context in commands.contexts:
            self.assertFalse(context.exists())

    def test_clean_main_is_pinned_after_fetch_without_modifying_worktree(self):
        results = [subprocess.CompletedProcess([], 0, "main\n", ""),
                   subprocess.CompletedProcess([], 0, b"", b""),
                   subprocess.CompletedProcess([], 0, SOURCE + "\n", ""),
                   subprocess.CompletedProcess([], 0, "", ""),
                   subprocess.CompletedProcess([], 0, SOURCE + "\n", "")]
        with patch.object(build.subprocess, "run", side_effect=results) as commands:
            self.assertEqual(build.committed_source(self.root), SOURCE)
        self.assertEqual([call.args[0] for call in commands.call_args_list], [
            ["git", "symbolic-ref", "--short", "HEAD"],
            ["git", "status", "--porcelain=v1", "--untracked-files=all", "-z"],
            ["git", "rev-parse", "--verify", "HEAD"],
            ["git", "fetch", "--no-tags", "--no-write-fetch-head", "origin", "refs/heads/main:refs/remotes/origin/main"],
            ["git", "rev-parse", "refs/remotes/origin/main"],
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
                    build.build_images(self.root, ["web"], self.cloud)
                self.assertTrue(all(call.args[0][0] == "git" for call in commands.call_args_list))
                self.cloud.assert_not_called()

    def test_explicit_pinned_revision_does_not_reread_a_later_checkout_head(self):
        commands = FakeCommands(self.root)
        with patch.object(build, "find_reusable_image", return_value=None), \
                patch.object(build.subprocess, "run", side_effect=commands), \
                contextlib.redirect_stdout(io.StringIO()):
            build.build_images(self.root, ["web"], self.cloud, source=SOURCE)
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
            self.assertTrue(Path(cmd[cmd.index("--file") + 1]).as_posix()
                            .endswith(f"apps/{service}/Dockerfile"))
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
            self.assertNotIn("NPM_REGISTRY", arguments)
            self.assertEqual(kw["env"]["DOCKER_HOST"], "unix:///fixture/docker.sock")
            self.assertNotIn("DOCKER_CONTEXT", kw["env"])
            self.assertNotIn("BUILDX_BUILDER", kw["env"])
            self.assertNotIn("BUILDX_CONFIG", kw["env"])
            self.assertNotIn("BUILDKIT_HOST", kw["env"])
        self.assertEqual(self.cloud.call_count, 7)
        self.cloud.assert_called_with("cr", "GetAuthorizationToken", "--InstanceId", build.INSTANCE_ID)
        self.assert_cleaned(commands)

    def test_opt_in_npm_registry_is_passed_only_when_requested(self):
        mirror = "https://registry.npmmirror.com"
        images, commands, output = self.run_build(
            ["admin-ui", "server"],
            npm_registry=mirror,
        )
        self.assertEqual(set(images), {"admin-ui", "server"})
        self.assertIn(f"Using opt-in npm registry for this build: {mirror}", output)
        builds = [cmd for cmd, _ in commands.calls if cmd[:3] == ["docker", "buildx", "build"]]
        self.assertEqual(len(builds), 2)
        for cmd in builds:
            arguments = dict(cmd[index + 1].split("=", 1) for index, value in enumerate(cmd)
                             if value == "--build-arg")
            self.assertEqual(arguments.get("NPM_REGISTRY"), mirror)
        with self.assertRaisesRegex(build.BuildError, "https URL"):
            build.optional_npm_registry("http://insecure.example/npm")

    def test_password_uses_stdin_and_private_temp_config_is_removed(self):
        _, commands, output = self.run_build(["web"])
        login, kwargs = next((cmd, kw) for cmd, kw in commands.calls if cmd[:2] == ["docker", "login"])
        self.assertEqual(login, ["docker", "login", build.PUSH_HOST, "--username", "fixture-user",
                                 "--password-stdin"])
        self.assertEqual(kwargs["input"], "fixture-token\n")
        self.assertTrue(kwargs["capture_output"])
        self.assertNotIn("fixture-token", str(login))
        self.assertNotIn("fixture-token", output)
        self.assert_cleaned(commands)

    def test_only_existing_buildx_plugin_is_linked_and_checked_before_authentication(self):
        commands = FakeCommands(self.root)

        def authorize(*args):
            self.assertEqual(len(commands.plugin_links), 1)
            # Every refresh still occurs after isolated buildx setup.
            config = commands.isolated_configs[0]
            if not commands.configs:
                self.assertEqual(list(config.iterdir()), [config / "cli-plugins"])
            plugins = list((config / "cli-plugins").iterdir())
            self.assertTrue(plugins)
            self.assertTrue(all(path.name.startswith("docker-buildx") for path in plugins))
            return {"IsSuccess": True, "TempUsername": "fixture-user",
                    "AuthorizationToken": "fixture-token"}

        self.cloud.side_effect = authorize
        self.run_build(["web"], commands)
        link, target, was_symlink = commands.plugin_links[0]
        if was_symlink:
            self.assertEqual(target, self.plugin.resolve())
        # Temp build config is removed after build_images returns.
        self.assertFalse(link.exists())
        self.assertTrue(self.plugin.exists())
        self.assert_cleaned(commands)

    def test_unavailable_buildx_in_isolated_config_stops_before_token_and_cleans_up(self):
        commands = FakeCommands(self.root, isolated_version_status=1)
        with self.assertRaisesRegex(RuntimeError, "isolated build configuration"):
            self.run_build(["web"], commands)
        self.cloud.assert_not_called()
        self.assertFalse(commands.configs)
        self.assertFalse(commands.contexts)
        self.assert_cleaned(commands)

    def test_missing_or_nonexecutable_plugin_is_rejected_before_registry_auth(self):
        invalid = [[], [{"Name": "other", "Path": str(self.plugin)}],
                   [{"Name": "buildx", "Path": str(self.base / "absent-plugin")}],
                   [{"Name": "buildx", "Path": 42}]]
        for plugins in invalid:
            with self.subTest(plugins=plugins), self.assertRaisesRegex(RuntimeError, "buildx plugin"):
                self.run_build(["web"], FakeCommands(self.root, plugins=plugins))
        self.plugin.chmod(0o600)
        with self.assertRaisesRegex(RuntimeError, "buildx plugin"):
            self.run_build(["web"])
        self.cloud.assert_not_called()

    def test_login_failure_hides_cli_token_and_removes_temp_config(self):
        commands = FakeCommands(self.root, login_status=1)
        with self.assertRaisesRegex(RuntimeError, "Docker login failed") as error:
            self.run_build(["web"], commands)
        self.assertNotIn("fixture-token", str(error.exception))
        self.assertFalse(commands.contexts)
        self.assert_cleaned(commands)

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

    def test_missing_harness_integration_stops_before_registry_auth(self):
        (self.root / "apps/server/src/app.module.ts").write_text("imports: []")
        for service in ["server", "studio", "game-agent"]:
            with self.subTest(service=service), self.assertRaisesRegex(ValueError, "Harness integration"):
                self.run_build([service])
        self.cloud.assert_not_called()

    def test_legacy_empty_duplicate_and_unknown_services_stop_before_commands(self):
        for services in [["agent"], [], ["web", "web"], ["unknown"]]:
            with self.subTest(services=services), patch.object(build.subprocess, "run") as run:
                with self.assertRaises(ValueError):
                    build.build_images(self.root, services, self.cloud)
                run.assert_not_called()
        self.cloud.assert_not_called()


if __name__ == "__main__":
    unittest.main()


class RegistryReuseTests(unittest.TestCase):
    def lookup(self, changed=False, corrupt=False, failure=False, second_page=False):
        digest = 'sha256:' + 'a' * 64
        calls = []
        def cloud(*args):
            calls.append(args)
            if failure:
                raise RuntimeError('registry unavailable')
            result = {'IsSuccess': True, 'Code': 'success'}
            if args[1] == 'ListRepository':
                result.update(TotalCount=1, Repositories=[{'RepoId': 'repo',
                    'RepoName': 'fizzdragon-web', 'RepoNamespaceName': 'fizzdragon',
                    'InstanceId': build.INSTANCE_ID, 'RepoStatus': 'NORMAL'}])
            elif args[1] == 'ListRepoTag':
                page = args[args.index('--PageNo') + 1]
                rows = [{'Tag': SOURCE, 'Digest': digest, 'Status': 'NORMAL'}]
                if second_page and page == '1':
                    rows = [{'Tag': 'not-a-commit'}] * 100
                result.update(TotalCount=101 if second_page else 1, Images=rows)
            else:
                result.update(Tag=SOURCE, Digest='bad' if corrupt else digest, Status='NORMAL')
            return result
        with patch.object(build, 'service_inputs', side_effect=['current', 'different' if changed else 'current']), \
                patch.object(build.subprocess, 'run', side_effect=lambda cmd, **kw: subprocess.CompletedProcess(cmd, 0, (SOURCE + '\n').encode() if 'rev-list' in cmd else 'deploy/aliyun-sg/production-build.py\n')):
            return build.find_reusable_image(Path('/fixture'), SOURCE, 'web', cloud), calls

    def test_existing_image_reused_after_prior_partial_release(self):
        result, calls = self.lookup()
        self.assertTrue(result.endswith('@sha256:' + 'a' * 64))
        self.assertEqual(calls[-1][1], 'GetRepoTag')

    def test_changed_inputs_require_build(self):
        self.assertIsNone(self.lookup(changed=True)[0])

    def test_registry_error_is_not_cache_miss(self):
        with self.assertRaises(RuntimeError):
            self.lookup(failure=True)

    def test_changed_digest_rejected(self):
        with self.assertRaises(build.BuildError):
            self.lookup(corrupt=True)

    def test_registry_pagination(self):
        result, calls = self.lookup(second_page=True)
        self.assertIsNotNone(result)
        self.assertEqual(sum(c[1] == 'ListRepoTag' for c in calls), 2)


class HistoricalRecipeTests(unittest.TestCase):
    def test_legacy_image_without_recipe_is_skipped_before_fingerprinting(self):
        digest = 'sha256:' + 'a' * 64
        cloud = Mock(side_effect=[
            {'IsSuccess': True, 'Code': 'success', 'TotalCount': 1, 'Repositories': [
                {'RepoId': 'repo', 'RepoName': 'fizzdragon-web', 'RepoNamespaceName': 'fizzdragon',
                 'InstanceId': build.INSTANCE_ID, 'RepoStatus': 'NORMAL'}]},
            {'IsSuccess': True, 'Code': 'success', 'TotalCount': 1, 'Images': [
                {'Tag': SOURCE, 'Digest': digest, 'Status': 'NORMAL'}]},
        ])
        with patch.object(build, 'service_inputs', return_value='current') as identity, \
                patch.object(build.subprocess, 'run', side_effect=[
                    subprocess.CompletedProcess([], 0, (SOURCE + '\n').encode()),
                    subprocess.CompletedProcess([], 0),
                    subprocess.CompletedProcess([], 0, '')]):
            self.assertIsNone(build.find_reusable_image(Path('/fixture'), SOURCE, 'web', cloud))
            identity.assert_called_once()
        self.assertEqual(cloud.call_count, 2)
