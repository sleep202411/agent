import json
import subprocess
import unittest
from unittest.mock import Mock, patch
import cn_registry as registry


class RegistryRetryTests(unittest.TestCase):
    def success(self):
        return Mock(stdout=json.dumps({'IsSuccess': True, 'Code': 'success', 'Repositories': []}))

    def test_timeout_then_success_retries_the_same_read(self):
        with patch.object(registry.subprocess, 'run', side_effect=[
                subprocess.TimeoutExpired('aliyun', 45), self.success()]) as run, \
                patch.object(registry.time, 'sleep') as sleep:
            self.assertTrue(registry.query('ListRepository')['IsSuccess'])
            self.assertEqual(run.call_args_list[0], run.call_args_list[1])
            sleep.assert_called_once_with(2)

    def test_transport_failure_and_bad_json_retry(self):
        for failure in [subprocess.CalledProcessError(1, 'aliyun', stderr='connection reset'),
                        Mock(stdout='proxy unavailable'), Mock(stdout='[]')]:
            with self.subTest(failure=failure), \
                    patch.object(registry.subprocess, 'run', side_effect=[failure, self.success()]), \
                    patch.object(registry.time, 'sleep') as sleep:
                registry.query('ListRepository')
                sleep.assert_called_once_with(2)

    def test_permission_failure_never_retries_or_exposes_cli_output(self):
        for failure in [
            subprocess.CalledProcessError(1, 'aliyun', stderr='ErrorCode: Forbidden\nsigned-secret'),
            subprocess.CalledProcessError(1, 'aliyun', output='{"Code":"Forbidden"}'),
            subprocess.CalledProcessError(1, 'aliyun', stderr='AccessDenied signed-secret'),
            Mock(stdout='{"Code":"IMAGE_NOT_EXIST"}'),
        ]:
            with patch.object(registry.subprocess, 'run', side_effect=[failure]) as run, \
                    patch.object(registry.time, 'sleep') as sleep:
                with self.assertRaises(RuntimeError) as caught:
                    registry.query('GetRepoTag')
                self.assertNotIn('signed-secret', str(caught.exception))
                self.assertEqual(run.call_count, 1)
                sleep.assert_not_called()

    def test_throttling_retries(self):
        with patch.object(registry.subprocess, 'run', side_effect=[
                Mock(stdout='{"Code":"Throttling.User"}'), self.success()]), \
                patch.object(registry.time, 'sleep') as sleep:
            registry.query('GetRepoTag')
            sleep.assert_called_once_with(2)

    def test_retries_are_bounded_and_report_timeout(self):
        with patch.object(registry.subprocess, 'run',
                          side_effect=subprocess.TimeoutExpired('aliyun', 45)) as run, \
                patch.object(registry.time, 'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError, '4 attempt.*timed out'):
                registry.query('ListRepository')
            self.assertEqual(run.call_count, 4)
            self.assertEqual([call.args[0] for call in sleep.call_args_list], [2, 5, 10])


if __name__ == '__main__':
    unittest.main()
