import os
import argparse
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock
from release_revision import latest_source, ToolingUpdated
import cn_release


class RevisionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.git('init', '-b', 'main')
        self.git('config', 'user.name', 'test')
        self.git('config', 'user.email', 'test@example.invalid')
        self.git('config', 'core.hooksPath', '/dev/null')
        self.git('init', '--bare', str(self.root / 'origin.git'))
        self.git('remote', 'add', 'origin', str(self.root / 'origin.git'))
        self.source = self.commit('app.txt', 'initial')
        self.git('push', 'origin', 'main')

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True,
                                       stderr=subprocess.DEVNULL).strip()

    def commit(self, name, text):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        self.git('add', name)
        self.git('commit', '-m', 'update')
        return self.git('rev-parse', 'HEAD')

    def test_local_committed_update_and_dirty_work_are_distinct(self):
        (self.repo / 'app.txt').write_text('unsaved')
        self.assertEqual(latest_source(self.repo, self.source, cn=True), self.source)
        new = self.commit('app.txt', 'next')
        self.assertEqual(latest_source(self.repo, self.source, cn=True), new)

    def test_remote_update_does_not_move_operator_checkout(self):
        new = self.commit('app.txt', 'next')
        self.git('push', 'origin', 'main')
        self.git('reset', '--hard', self.source)
        self.assertEqual(latest_source(self.repo, self.source, cn=True), new)
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.source)

    def test_deployment_only_update_reuses_images(self):
        self.commit('deploy/script.sh', 'updated tooling')
        self.assertEqual(latest_source(self.repo, self.source, cn=True), self.source)

    def test_remote_tooling_update_requires_reload_before_rollout(self):
        new = self.commit('deploy/deploy-cn-services.sh', 'disable unselected worker')
        self.git('push', 'origin', 'main')
        self.git('reset', '--hard', self.source)
        with self.assertRaises(ToolingUpdated) as caught:
            latest_source(self.repo, self.source, cn=True, require_current_tooling=True)
        self.assertEqual(caught.exception.revision, new)
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.source)

    def test_current_tooling_can_reuse_old_application_images(self):
        self.commit('deploy/deploy-cn-services.sh', 'disable unselected worker')
        self.assertEqual(latest_source(self.repo, self.source, cn=True,
                                       require_current_tooling=True), self.source)

    def test_preflight_accepts_reloaded_remote_main_and_rejects_unrelated_head(self):
        self.commit('deploy/cn-preflight.sh', Path(__file__).with_name('cn-preflight.sh').read_text())
        self.commit('deploy/helm/fizzdragon/values.yaml', 'fixture chart')
        previous = self.commit('deploy/cn_build_credentials.py', 'pass\n')
        updated = self.commit('deploy/tooling.txt', 'remote update')
        self.git('push', 'origin', 'main')
        self.git('reset', '--hard', previous)
        self.git('checkout', '--detach', updated)
        binaries = self.root / 'bin'
        binaries.mkdir()
        for command in ('node', 'openssl', 'helm', 'kubectl', 'aliyun', 'ssh', 'scp', 'shasum', 'curl'):
            stub = binaries / command
            stub.write_text('#!/bin/sh\nexit 0\n')
            stub.chmod(0o755)
        key = self.root / 'key'
        key.write_text('fixture key')

        def preflight():
            return subprocess.run(
                ['/bin/bash', str(self.repo / 'deploy/cn-preflight.sh'), '--phase', 'build', 'server'],
                cwd=self.repo, capture_output=True, text=True, timeout=10,
                env={**os.environ, 'PATH': str(binaries) + os.pathsep + os.environ['PATH'],
                     'DEPLOY_KEY': str(key), 'FORCE': '0', 'ALLOW_DIRTY': '0'},
            )

        accepted = preflight()
        self.assertEqual(accepted.returncode, 0, accepted.stdout + accepted.stderr)
        self.assertIn('isolated production checkout belongs to main', accepted.stdout)
        self.git('checkout', '--orphan', 'unrelated')
        unrelated = self.commit('app.txt', 'unrelated history')
        self.git('checkout', '--detach', unrelated)
        denied = preflight()
        self.assertNotEqual(denied.returncode, 0)
        self.assertIn('production releases must run from main', denied.stderr)

    def test_build_helper_only_fix_advances_pinned_archive(self):
        old = self.commit('deploy/cn-remote-build-services.sh',
                          'docker system prune --all --force --build\n')
        new = self.commit('deploy/cn-remote-build-services.sh',
                          'docker system prune --all --force\n')
        self.git('push', 'origin', 'main')
        self.assertEqual(latest_source(self.repo, old, cn=True), new)
        state = dict(version=1, tag=old, services=['web'], namespace='fizzdragon',
                     release='fizzdragon', context='cn', clusterServer='https://cn')
        calls = []
        def invoke(*args, **kwargs):
            if '--build-only' in args:
                calls.append(args[2])
                helper = self.git('show', args[2] + ':deploy/cn-remote-build-services.sh')
                self.assertNotIn('--build', helper)
        with patch.object(cn_release, 'ROOT', self.repo), \
             patch.object(cn_release, 'revision', side_effect=lambda tag: tag), \
             patch.object(cn_release, 'find_image', return_value=None), \
             patch.object(cn_release, 'verify', return_value={'web': 'digest'}), \
             patch.object(cn_release, 'run', side_effect=invoke):
            cn_release.run_cycles(state, argparse.Namespace(backup_id=None, allow_chart_update=True), Mock())
        self.assertEqual(calls, [new])
        self.assertTrue(state['complete'])
        self.assertEqual(state['previousCycles'][0]['tag'], old)

    def test_cn_chart_updates_require_a_new_cycle(self):
        new = self.commit('deploy/helm/fizzdragon/values.yaml', 'new chart')
        self.assertEqual(latest_source(self.repo, self.source, cn=True), new)

    def test_com_image_tag_update_does_not_restart_cn(self):
        before = self.commit('deploy/helm/fizzdragon/values.yaml',
                             'web:\n  image:\n    repository: fizzdragon-web\n    tag: old\n')
        self.commit('deploy/helm/fizzdragon/values.yaml',
                    'web:\n  image:\n    repository: fizzdragon-web\n    tag: newer\n')
        self.assertEqual(latest_source(self.repo, before, cn=True), before)

    def test_repository_or_other_config_still_restarts_cn(self):
        before = self.commit('deploy/helm/fizzdragon/values.yaml',
                             'web:\n  image:\n    repository: old\n    tag: old\n')
        newer = self.commit('deploy/helm/fizzdragon/values.yaml',
                            'web:\n  image:\n    repository: changed\n    tag: newer\n')
        self.assertEqual(latest_source(self.repo, before, cn=True), newer)

    def test_divergence_is_not_automatically_overwritten(self):
        self.commit('app.txt', 'remote')
        self.git('push', 'origin', 'main')
        self.git('reset', '--hard', self.source)
        self.commit('app.txt', 'local')
        with self.assertRaisesRegex(RuntimeError, 'diverged'):
            latest_source(self.repo, self.source, cn=True)

    def test_isolated_cn_tooling_preserves_operator_changes(self):
        original = cn_release.ROOT
        cn_release.ROOT = self.repo
        try:
            with cn_release.stable_checkout():
                isolated = cn_release.ROOT
                self.commit('app.txt', 'new source')
                (self.repo / 'app.txt').write_text('work in progress')
                self.assertEqual((isolated / 'app.txt').read_text(), 'initial')
            self.assertFalse(isolated.exists())
            self.assertEqual((self.repo / 'app.txt').read_text(), 'work in progress')
        finally:
            cn_release.ROOT = original


class RetiredComTests(unittest.TestCase):
    def test_old_default_stops_before_fetch_or_other_git_operations(self):
        with patch('release_revision.git') as git:
            with self.assertRaisesRegex(RuntimeError, 'retired; use deploy/deploy-com.sh'):
                latest_source(Path('/missing'), 'a'*40)
            git.assert_not_called()

    def test_old_cli_stops_without_git(self):
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name('release_revision.py')),
             '/missing', 'a'*40, 'main'],
            env={**os.environ, 'PATH': '/nonexistent'}, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn('retired; use deploy/deploy-com.sh', result.stderr)
        self.assertNotIn('Traceback', result.stderr)


if __name__ == '__main__':
    unittest.main()
