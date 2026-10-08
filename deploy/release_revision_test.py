import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from release_revision import latest_source
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
