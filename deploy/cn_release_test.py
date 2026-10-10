import argparse
import contextlib
import datetime as dt
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock
import cn_release as r
import cn_registry as registry

TAG = 'a' * 40
IMAGE = 'registry/fizzdragon-server:' + TAG


def job(condition=None):
    return {'metadata': {'labels': {'fizzdragon.com/revision': TAG},
                         'annotations': {'fizzdragon.com/rds-backup-id': '123'}},
            'spec': {'template': {'spec': {'containers': [{'image': IMAGE, 'command': ['npm', 'run', 'db:deploy']}]}}},
            'status': {'conditions': [{'type': condition, 'status': 'True'}] if condition else []}}


class ReleaseTests(unittest.TestCase):
    @patch.dict(r.os.environ, {}, clear=True)
    @patch.object(r.sys, 'argv', ['cn_release.py', 'release', 'web'])
    @patch.object(r.os, 'execv')
    @patch.object(r, 'run', side_effect=RuntimeError('SSH blocked'))
    def test_ssh_failure_occurs_before_lock_or_checkout(self, run, execute):
        with self.assertRaisesRegex(RuntimeError, 'SSH blocked'):
            r.main()
        execute.assert_not_called()
        self.assertIn('--required', run.call_args.args)

    def test_backup_job_id_is_resolved_to_backup_id(self):
        state = {}
        with patch.object(r, 'rds', side_effect=[{'BackupJobId': 456}, {'Items': {'BackupJob': [
                {'BackupJobId': 456, 'BackupStatus': 'Finished', 'BackupId': 123}]}}]) as api, \
                patch.object(r, 'validate_backup') as validate:
            self.assertEqual(r.ensure_backup(state, Mock()), '123')
            validate.assert_called_once_with('123')
            self.assertEqual(api.call_args.kwargs, {'BackupJobId': '456'})

    def test_finished_backup_waits_for_catalogue_visibility_without_creating_again(self):
        state = {'backupRequested': True, 'backupJobId': '456'}
        task = {'Items': {'BackupJob': [
            {'BackupJobId': 456, 'BackupStatus': 'Finished', 'BackupId': 123}]}}
        with patch.object(r, 'rds', return_value=task) as api, \
                patch.object(r, 'validate_backup', side_effect=[r.BackupNotReady('pending'), {}]), \
                patch.object(r.time, 'sleep') as sleep:
            self.assertEqual(r.ensure_backup(state, Mock()), '123')
            self.assertEqual(state['backupId'], '123')
            self.assertEqual([call.args[0] for call in api.call_args_list],
                             ['DescribeBackupTasks', 'DescribeBackupTasks'])
            sleep.assert_called_once_with(15)

    def test_finished_backup_does_not_retry_invalid_backup(self):
        state = {'backupRequested': True, 'backupJobId': '456'}
        task = {'Items': {'BackupJob': [
            {'BackupJobId': 456, 'BackupStatus': 'Finished', 'BackupId': 123}]}}
        with patch.object(r, 'rds', return_value=task), \
                patch.object(r, 'validate_backup', side_effect=RuntimeError('invalid backup')), \
                patch.object(r.time, 'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, 'invalid backup'):
                r.ensure_backup(state, Mock())
            sleep.assert_not_called()
            self.assertNotIn('backupId', state)

    def test_uncertain_backup_request_never_duplicates(self):
        with patch.object(r, 'rds') as api:
            with self.assertRaisesRegex(RuntimeError, 'outcome is unknown'):
                r.ensure_backup({'backupRequested': True}, Mock())
            api.assert_not_called()

    def test_resume_reuses_backup_job(self):
        state = {'backupRequested': True, 'backupJobId': '456'}
        with patch.object(r, 'rds', return_value={'Items': {'BackupJob': [
                {'BackupJobId': 456, 'BackupStatus': 'Finished', 'BackupId': 123}]}}) as api, \
                patch.object(r, 'validate_backup'):
            self.assertEqual(r.ensure_backup(state, Mock()), '123')
            self.assertEqual(api.call_args.args, ('DescribeBackupTasks',))

    def test_backup_validation_rejects_job_id_and_expiry(self):
        with patch.object(r, 'rds', return_value={'Items': {'Backup': []}}):
            with self.assertRaisesRegex(r.BackupNotReady, 'not yet visible'):
                r.validate_backup('456')
        ended = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=7)).isoformat()
        row = {'BackupId': 123, 'BackupMode': 'Manual', 'BackupStatus': 'Success', 'IsAvail': 1, 'BackupEndTime': ended}
        with patch.object(r, 'rds', return_value={'Items': {'Backup': [row]}}):
            with self.assertRaises(r.ExpiredBackup):
                r.validate_backup('123')

    def test_job_audit_and_failed_job(self):
        self.assertEqual(r.job_state(job(), IMAGE, TAG), 'active')
        self.assertEqual(r.job_state(job('Complete'), IMAGE, TAG), 'complete')
        with self.assertRaisesRegex(RuntimeError, 'automatic deletion'):
            r.job_state(job('Failed'), IMAGE, TAG)
        with self.assertRaisesRegex(RuntimeError, 'does not match'):
            r.job_state(job('Complete'), IMAGE + 'wrong', TAG)

    def migration_context(self):
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.dict(r.os.environ, {'CONFIRM_CN_PROD_MIGRATION': 'YES'}))
        stack.enter_context(patch.object(r, 'chart_snapshot', return_value=contextlib.nullcontext(Path('/fixture'))))
        run = stack.enter_context(patch.object(r, 'run', return_value='  image: "' + IMAGE + '"'))
        backup = stack.enter_context(patch.object(r, 'ensure_backup', return_value='123'))
        verify = stack.enter_context(patch.object(r, 'verify'))
        return stack, run, backup, verify

    def test_missing_image_never_creates_backup_or_migration(self):
        stack, run, backup, verify = self.migration_context()
        verify.side_effect = RuntimeError('missing image')
        stack.enter_context(patch.object(r, 'get_job', return_value=None))
        with self.assertRaisesRegex(RuntimeError, 'missing image'):
            r.migration(TAG, state={}, persist=Mock())
        backup.assert_not_called()
        self.assertFalse(any(c.args[0] == 'kubectl' for c in run.call_args_list))

    def test_completed_migration_is_not_repeated(self):
        stack, run, backup, verify = self.migration_context()
        stack.enter_context(patch.object(r, 'get_job', return_value=job('Complete')))
        r.migration(TAG, state={}, persist=Mock())
        backup.assert_not_called()
        verify.assert_not_called()
        self.assertFalse(any(c.args[0] == 'kubectl' for c in run.call_args_list))

    def test_active_migration_reattaches_without_new_job_or_backup(self):
        stack, run, backup, verify = self.migration_context()
        stack.enter_context(patch.object(r, 'get_job', side_effect=[job(), job('Complete')]))
        r.migration(TAG, state={}, persist=Mock())
        backup.assert_not_called()
        self.assertFalse(any(c.args[0] == 'kubectl' for c in run.call_args_list))

    def test_new_migration_creates_exactly_once_after_backup(self):
        stack, run, backup, verify = self.migration_context()
        stack.enter_context(patch.object(r, 'get_job', side_effect=[None, job('Complete')]))
        r.migration(TAG, state={}, persist=Mock())
        backup.assert_called_once()
        creates = [c for c in run.call_args_list if c.args[:2] == ('kubectl', 'create')]
        self.assertEqual(len(creates), 1)
        self.assertIn(IMAGE, creates[0].kwargs['input'])

    def test_atomic_receipt_has_private_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'receipt.json'
            r.save(path, {'tag': TAG})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_resume_keeps_original_tag_after_head_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / 'fizzdragon-releases/cn.json'
            state = {'version': 1, 'tag': TAG, 'services': ['server'], 'built': False, 'useExistingImages': True,
                     'digests': {'server': 'digest'}, 'namespace': 'fizzdragon',
                     'release': 'fizzdragon', 'context': 'cn', 'clusterServer': 'https://cn'}
            r.save(receipt, state)
            def run(*args, **kwargs):
                if args[:3] == ('git', 'branch', '--show-current'):
                    return 'main'
                if args[:2] == ('git', 'rev-parse'):
                    return directory
            args = argparse.Namespace(resume=True, tag=None, services=[], backup_id=None, allow_chart_update=True, use_existing_images=True)
            with patch.object(r, 'run', side_effect=run) as calls, \
                    patch.object(r, 'kubectl', return_value='cn'), \
                    patch.object(r, 'cluster_server', return_value='https://cn'), \
                    patch.object(r, 'revision', side_effect=lambda tag: tag) as revision, \
                    patch.object(r, 'latest_source', side_effect=lambda root, tag, **kw: tag), \
                    patch.object(r, 'get_job', return_value=None), \
                    patch.object(r, 'verify', return_value={'server': 'digest'}), \
                    patch.object(r, 'migration') as migrate, \
                    patch.dict(r.os.environ, {'CONFIRM_CN_PROD_MIGRATION': 'YES', 'CN_NAMESPACE': 'fizzdragon', 'CN_RELEASE': 'fizzdragon'}):
                r.release(args)
                revision.assert_called_once_with(TAG)
                self.assertEqual(migrate.call_args.args[0], TAG)
                deployment = [c for c in calls.call_args_list if '--deploy-only' in c.args]
                self.assertEqual(len(deployment), 1)
                self.assertFalse(any('--build-only' in c.args for c in calls.call_args_list))
                self.assertEqual(deployment[0].args[1:3], ('--tag', TAG))
                self.assertTrue(r.json.loads(receipt.read_text())['complete'])
                calls.reset_mock()
                r.release(args)
                self.assertFalse(any('--deploy-only' in c.args for c in calls.call_args_list))

    def test_reused_server_image_keeps_new_release_migration_audit(self):
        old = 'b' * 40
        image = 'registry/fizzdragon-server:' + old
        stack, run, backup, verify = self.migration_context()
        run.return_value = '  image: "' + image + '"'
        verify.return_value = {'server': 'digest'}
        complete = job('Complete')
        complete['spec']['template']['spec']['containers'][0]['image'] = image
        stack.enter_context(patch.object(r, 'get_job', side_effect=[None, complete]))
        r.migration(TAG, state={'imageTags': {'server': old}, 'digests': {'server': 'digest'}}, persist=Mock())
        verify.assert_called_once_with(old, ['server'])
        rendered = [c for c in run.call_args_list if c.args[:2] == ('helm', 'template')]
        self.assertTrue(all('server.image.tag=' + old in c.args for c in rendered))
        self.assertTrue(all('server.migrationJob.revision=' + TAG in c.args for c in rendered))

    def test_digest_change_prevents_backup_and_migration(self):
        stack, run, backup, verify = self.migration_context()
        verify.return_value = {'server': 'changed'}
        stack.enter_context(patch.object(r, 'get_job', return_value=None))
        with self.assertRaisesRegex(RuntimeError, 'changed before migration'):
            r.migration(TAG, state={'digests': {'server': 'expected'}}, persist=Mock())
        backup.assert_not_called()
        self.assertFalse(any(c.args[:2] == ('kubectl', 'create') for c in run.call_args_list))



class RegistryTests(unittest.TestCase):
    def test_verifies_exact_service_tag_digest(self):
        rows = {'TotalCount': 1, 'Repositories': [{'RepoName': 'fizzdragon-server',
                 'RepoNamespaceName': 'fizzdragon', 'InstanceId': registry.INSTANCE,
                 'RepoStatus': 'NORMAL', 'RepoId': 'repo'}]}
        with patch.object(registry, 'query', side_effect=[rows, {'Tag': TAG, 'Status': 'NORMAL', 'Digest': 'b' * 64}]) as api:
            self.assertEqual(registry.verify(TAG, ['server']), {'server': 'sha256:' + 'b' * 64})
            self.assertEqual(api.call_args.kwargs, {'RepoId': 'repo', 'Tag': TAG})

    def test_api_success_exit_with_error_payload_is_failure(self):
        response = Mock(stdout='{"Code":"IMAGE_NOT_EXIST"}')
        with patch.object(registry.subprocess, 'run', return_value=response):
            with self.assertRaisesRegex(RuntimeError, 'IMAGE_NOT_EXIST'):
                registry.query('GetRepoTag')

    def test_rejects_floating_revision(self):
        with self.assertRaises(ValueError):
            registry.verify('main', ['server'])



class CycleTests(unittest.TestCase):
    def context(self, checkpoints, existing=None):
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        events = []
        stack.enter_context(patch.object(r, 'find_image', return_value=None))
        stack.enter_context(patch.object(r, 'revision', side_effect=lambda tag: tag))
        stack.enter_context(patch.object(r, 'latest_source', side_effect=checkpoints))
        stack.enter_context(patch.object(r, 'get_job', return_value=existing))
        stack.enter_context(patch.object(r, 'verify', side_effect=lambda tag, services: {'server': tag}))
        stack.enter_context(patch.object(r, 'run', side_effect=lambda *a, **kw: events.append(('build' if '--build-only' in a else 'deploy', a[2]))))
        migrate = stack.enter_context(patch.object(r, 'migration', side_effect=lambda tag, *a, **kw: events.append(('migration', tag))))
        state = dict(version=1, tag=TAG, services=['server'], namespace='fizzdragon',
                     release='fizzdragon', context='cn', clusterServer='https://cn')
        args = argparse.Namespace(backup_id=None, allow_chart_update=True)
        return state, args, events, migrate

    def test_commit_during_build_rebuilds_before_migrating(self):
        new = 'b' * 40
        state, args, events, _ = self.context([TAG, new, new, new, new, new])
        r.run_cycles(state, args, Mock())
        self.assertEqual(events, [('build', TAG), ('build', new), ('migration', new), ('deploy', new)])
        self.assertTrue(state['complete'])
        self.assertEqual(state['previousCycles'][0]['tag'], TAG)

    def test_commit_during_migration_finishes_before_rebuild(self):
        new = 'b' * 40
        state, args, events, _ = self.context([TAG, TAG, new, new, new, new, new])
        r.run_cycles(state, args, Mock())
        self.assertEqual(events, [('build', TAG), ('migration', TAG), ('build', new), ('migration', new), ('deploy', new)])

    def test_resume_finishes_active_migration_before_source_checkpoint(self):
        new = 'b' * 40
        state, args, events, _ = self.context([new, new, new, new, new], existing=job())
        # Simulate only the old revision having an existing job.
        with patch.object(r, 'get_job', side_effect=[job(), None]):
            r.run_cycles(state, args, Mock())
        self.assertEqual(events[0], ('migration', TAG))
        self.assertNotIn(('deploy', TAG), events)

    def test_new_commit_during_rollout_gets_another_cycle(self):
        new = 'b' * 40
        state, args, events, _ = self.context([TAG, TAG, TAG, new, new, new, new, new])
        r.run_cycles(state, args, Mock())
        self.assertEqual([e for e in events if e[0] == 'deploy'], [('deploy', TAG), ('deploy', new)])

    def test_checkpoint_after_backup_prevents_old_migration_creation(self):
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(patch.dict(r.os.environ, {'CONFIRM_CN_PROD_MIGRATION': 'YES'}))
        stack.enter_context(patch.object(r, 'chart_snapshot', return_value=contextlib.nullcontext(Path('/fixture'))))
        calls = stack.enter_context(patch.object(r, 'run', return_value='  image: "' + IMAGE + '"'))
        stack.enter_context(patch.object(r, 'ensure_backup', return_value='123'))
        stack.enter_context(patch.object(r, 'verify'))
        stack.enter_context(patch.object(r, 'get_job', return_value=None))
        with self.assertRaises(r.SourceUpdated):
            r.migration(TAG, state={}, persist=Mock(), before_create=lambda: True)
        self.assertFalse(any(c.args[:2] == ('kubectl', 'create') for c in calls.call_args_list))

    def test_failed_existing_migration_stops_before_following_new_source(self):
        state, args, events, migrate = self.context([], existing=job())
        migrate.side_effect = RuntimeError('Migration job failed')
        with self.assertRaisesRegex(RuntimeError, 'Migration job failed'):
            r.run_cycles(state, args, Mock())
        self.assertEqual(events, [])
        self.assertEqual(state['tag'], TAG)

    def test_late_pre_helm_source_change_restarts_automatically(self):
        new = 'b' * 40
        state, args, events, _ = self.context([TAG, TAG, TAG, new, new, new, new, new])
        attempted = []
        def run(*a, **kw):
            if '--deploy-only' in a:
                attempted.append(a[2])
                if a[2] == TAG:
                    raise r.subprocess.CalledProcessError(75, 'deploy')
        with patch.object(r, 'run', side_effect=run):
            r.run_cycles(state, args, Mock())
        self.assertEqual(attempted, [TAG, new])
        self.assertTrue(state['complete'])

    def test_source_restart_does_not_duplicate_uncertain_backup_request(self):
        state, args, events, _ = self.context(['b' * 40])
        state['backupRequested'] = True
        with self.assertRaisesRegex(RuntimeError, 'outcome is unknown'):
            r.run_cycles(state, args, Mock())
        self.assertEqual(events, [])
        self.assertEqual(state['tag'], TAG)


if __name__ == '__main__':
    unittest.main()

class RetryTests(unittest.TestCase):
    def test_read_reset_retries_same_job(self):
        error = r.subprocess.CalledProcessError(1, 'aliyun', stderr='connection reset by peer')
        with patch.object(r.subprocess, 'run', side_effect=[error, Mock(stdout='{"Items":{}}')]) as calls, patch.object(r.time, 'sleep'):
            self.assertEqual(r.rds('DescribeBackupTasks', BackupJobId='456'), {'Items': {}})
            self.assertEqual(calls.call_count, 2)
            self.assertEqual(calls.call_args_list[0], calls.call_args_list[1])
    def test_create_is_never_retried(self):
        with patch.object(r.subprocess, 'run', side_effect=r.subprocess.TimeoutExpired('aliyun', 45)) as calls, patch.object(r.time, 'sleep') as sleep:
            with self.assertRaises(RuntimeError): r.rds('CreateBackup')
            self.assertEqual(calls.call_count, 1)
            sleep.assert_not_called()
    def test_permission_failure_stops_immediately(self):
        with patch.object(r.subprocess, 'run', side_effect=r.subprocess.CalledProcessError(1, 'aliyun', stderr='Forbidden')) as calls:
            with self.assertRaises(RuntimeError): r.rds('DescribeBackups')
            self.assertEqual(calls.call_count, 1)
    def test_retries_are_bounded(self):
        with patch.object(r.subprocess, 'run', side_effect=r.subprocess.TimeoutExpired('aliyun', 45)) as calls, patch.object(r.time, 'sleep'):
            with self.assertRaises(RuntimeError): r.rds('DescribeBackups')
            self.assertEqual(calls.call_count, 4)

    def test_permission_error_envelope_is_not_treated_as_empty_backup_list(self):
        with patch.object(r.subprocess, 'run', return_value=Mock(stdout='{"Code":"Forbidden"}')) as calls:
            with self.assertRaisesRegex(RuntimeError, 'Forbidden'): r.rds('DescribeBackupTasks')
            self.assertEqual(calls.call_count, 1)

class ExtendServicesTests(unittest.TestCase):
    def test_add_game_agent_preserves_backup_history(self):
        state = {'services': ['server'], 'imageTags': {'server': TAG}, 'previousCycles': [{'tag': TAG}]}
        r.extend_services(state, ['game-agent'])
        self.assertEqual(state['services'], ['game-agent', 'server'])
        self.assertNotIn('imageTags', state)
        self.assertEqual(state['previousCycles'], [{'tag': TAG}])

    def test_cannot_change_scope_after_build_or_backup(self):
        for key in ['complete', 'built', 'backupRequested', 'backupId']:
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                r.extend_services({'services': ['server'], key: True}, ['game-agent'])
