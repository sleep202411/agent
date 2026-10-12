import contextlib
import io
import ipaddress
import subprocess
import unittest
from unittest.mock import patch
import cn_ssh_access as access


class SshAccessTests(unittest.TestCase):
    def setUp(self):
        sleeper = patch.object(access.time, 'sleep')
        sleeper.start()
        self.addCleanup(sleeper.stop)

    @patch.object(access.subprocess, 'run')
    def test_transient_dns_read_recovers_without_leaking_raw_output(self, run):
        run.side_effect = [subprocess.CalledProcessError(1, ['aliyun'], stderr='lookup: no such host secret=fixture'),
                           subprocess.CompletedProcess([], 0, '{}', '')]
        output = io.StringIO()
        with contextlib.redirect_stderr(output):
            self.assertEqual(access.cloud('DescribeInstances'), {})
        self.assertEqual(run.call_count, 2)
        self.assertIn('DNS lookup failed', output.getvalue())
        self.assertNotIn('fixture', output.getvalue())

    @patch.object(access.subprocess, 'run')
    def test_mutations_and_authorization_denials_are_not_replayed(self, run):
        run.side_effect = subprocess.CalledProcessError(1, ['aliyun'], stderr='lookup: no such host')
        with self.assertRaisesRegex(RuntimeError, 'DNS lookup failed'):
            access.cloud('AuthorizeSecurityGroup')
        self.assertEqual(run.call_count, 1)
        run.reset_mock()
        run.side_effect = subprocess.CalledProcessError(1, ['aliyun'], stderr='Forbidden: credential=fixture')
        with self.assertRaisesRegex(RuntimeError, 'authorization rejected'):
            access.cloud('DescribeInstances')
        self.assertEqual(run.call_count, 1)

    @patch.object(access.subprocess, 'run')
    def test_persistent_dns_failure_is_bounded_and_names_the_operation(self, run):
        run.side_effect = subprocess.CalledProcessError(1, ['curl'], stderr='Could not resolve host: api.ipify.org')
        output = io.StringIO()
        with contextlib.redirect_stderr(output):
            self.assertEqual(access.check('fixture', required=True), 2)
        self.assertEqual(run.call_count, 3)
        self.assertIn('CN operator IPv4 lookup: DNS lookup failed', output.getvalue())
        self.assertIn('lock ownership is unchanged', output.getvalue())

    @patch.object(access, 'cloud')
    def test_lost_stop_reply_is_reconciled_before_any_second_stop(self, cloud):
        def status(value):
            return {'InstanceStatuses': {'InstanceStatus': [{'InstanceId': 'fixture', 'Status': value}]}}
        cloud.side_effect = [status('Running'), RuntimeError('CN ECS StopInstance: request timed out'), status('Stopping')]
        self.assertEqual(access.stop_builder('fixture'), 0)
        self.assertEqual([c.args[0] for c in cloud.call_args_list],
                         ['DescribeInstanceStatus', 'StopInstance', 'DescribeInstanceStatus'])

    @patch.object(access, 'cloud')
    def test_stop_does_not_target_an_unexpected_instance(self, cloud):
        cloud.return_value = {'InstanceStatuses': {'InstanceStatus': [{'InstanceId': 'other', 'Status': 'Running'}]}}
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(access.stop_builder('fixture'), 2)
        self.assertEqual(cloud.call_count, 1)

    @patch.object(access, 'cloud')
    def test_cleanup_outage_is_bounded_and_does_not_claim_stop(self, cloud):
        cloud.side_effect = RuntimeError('CN ECS DescribeInstanceStatus: DNS lookup failed')
        output = io.StringIO()
        with contextlib.redirect_stderr(output):
            self.assertEqual(access.stop_builder('fixture'), 2)
        self.assertEqual(cloud.call_count, 3)
        self.assertIn('stop unconfirmed', output.getvalue())
        self.assertTrue(all(c.args[0] == 'DescribeInstanceStatus' for c in cloud.call_args_list))

    def test_cidr_ports_and_policy(self):
        address = ipaddress.ip_address('192.0.2.10')
        rule = dict(Direction='ingress', Policy='Accept', IpProtocol='TCP', PortRange='22/22', SourceCidrIp='192.0.2.0/24')
        self.assertTrue(access.allows_ssh(rule, address))
        for changes in [dict(Policy='Drop'), dict(Direction='egress'), dict(PortRange='80/80'), dict(SourceCidrIp='192.0.3.0/24'), dict(IpProtocol='UDP')]:
            self.assertFalse(access.allows_ssh(dict(rule, **changes), address))
        self.assertTrue(access.allows_ssh(dict(rule, IpProtocol='ALL', PortRange='-1/-1'), address))

    @patch.object(access, 'cloud')
    @patch.object(access.subprocess, 'run')
    def test_changed_ip_stops_with_exact_cidr_and_group(self, run, cloud):
        run.return_value = subprocess.CompletedProcess([], 0, '192.0.2.10\n', '')
        cloud.side_effect = [{'Instances': {'Instance': [{'InstanceId': 'fixture', 'SecurityGroupIds': {'SecurityGroupId': ['sg-fixture']}}]}}, {'Permissions': {'Permission': []}}]
        output = io.StringIO()
        with contextlib.redirect_stderr(output):
            self.assertEqual(access.check('fixture'), 2)
        self.assertIn('192.0.2.10/32', output.getvalue())
        self.assertIn('sg-fixture', output.getvalue())
        self.assertTrue(all(call.args[0].startswith('Describe') for call in cloud.call_args_list))

    @patch.object(access.subprocess, 'run', side_effect=subprocess.TimeoutExpired(['curl'], 12))
    def test_diagnostic_outage_does_not_prevent_real_ssh_check(self, run):
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(access.check('fixture'), 0)

    @patch.object(access.subprocess, 'run', side_effect=subprocess.TimeoutExpired(['curl'], 12))
    def test_required_precheck_fails_closed(self, run):
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(access.check('fixture', required=True), 2)

    @patch.dict(access.os.environ, {'CN_AUTHORIZE_CURRENT_IP': 'YES', 'CN_SSH_SECURITY_GROUP': 'sg-fixture'})
    @patch.object(access, 'cloud')
    @patch.object(access.subprocess, 'run')
    def test_opt_in_authorizes_only_current_host_then_verifies(self, run, cloud):
        run.return_value = subprocess.CompletedProcess([], 0, '192.0.2.10', '')
        instance = {'Instances': {'Instance': [{'InstanceId': 'fixture', 'SecurityGroupIds': {'SecurityGroupId': ['sg-fixture']}}]}}
        rule = dict(Policy='accept', IpProtocol='tcp', PortRange='22/22', SourceCidrIp='192.0.2.10/32')
        cloud.side_effect = [instance, {'Permissions': {'Permission': []}}, {}, {'Permissions': {'Permission': [rule]}}]
        self.assertEqual(access.check('fixture', required=True), 0)
        mutation = cloud.call_args_list[2].args
        self.assertEqual(mutation[0], 'AuthorizeSecurityGroup')
        parameters = dict(zip(mutation[1::2], mutation[2::2]))
        self.assertEqual(parameters['--SecurityGroupId'], 'sg-fixture')
        self.assertEqual(parameters['--SourceCidrIp'], '192.0.2.10/32')
        self.assertEqual(parameters['--PortRange'], '22/22')
        self.assertEqual(parameters['--IpProtocol'], 'tcp')
        self.assertEqual(parameters['--Policy'], 'accept')
        self.assertEqual(parameters['--NicType'], 'intranet')
        self.assertNotIn('--Permissions', parameters)

    @patch.dict(access.os.environ, {'CN_AUTHORIZE_CURRENT_IP': 'YES', 'CN_SSH_SECURITY_GROUP': 'sg-other'})
    @patch.object(access, 'cloud')
    @patch.object(access.subprocess, 'run')
    def test_opt_in_rejects_unattached_group_without_mutation(self, run, cloud):
        run.return_value = subprocess.CompletedProcess([], 0, '192.0.2.10', '')
        cloud.side_effect = [{'Instances': {'Instance': [{'InstanceId': 'fixture', 'SecurityGroupIds': {'SecurityGroupId': ['sg-fixture']}}]}}, {'Permissions': {'Permission': []}}]
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(access.check('fixture', required=True), 2)
        self.assertTrue(all(c.args[0].startswith('Describe') for c in cloud.call_args_list))

    @patch.dict(access.os.environ, {'CN_AUTHORIZE_CURRENT_IP': 'YES', 'CN_SSH_SECURITY_GROUP': 'sg-fixture'})
    @patch.object(access, 'cloud')
    @patch.object(access.subprocess, 'run')
    def test_authorization_failure_never_falls_through(self, run, cloud):
        run.return_value = subprocess.CompletedProcess([], 0, '192.0.2.10', '')
        cloud.side_effect = [{'Instances': {'Instance': [{'InstanceId': 'fixture', 'SecurityGroupIds': {'SecurityGroupId': ['sg-fixture']}}]}}, {'Permissions': {'Permission': []}}, subprocess.CalledProcessError(1, ['aliyun'])]
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(access.check('fixture'), 2)

    @patch.dict(access.os.environ, {'CN_AUTHORIZE_CURRENT_IP': 'YES'})
    @patch.object(access, 'cloud')
    @patch.object(access.subprocess, 'run')
    def test_existing_access_is_idempotent(self, run, cloud):
        run.return_value = subprocess.CompletedProcess([], 0, '192.0.2.10', '')
        rule = dict(Policy='accept', IpProtocol='tcp', PortRange='22/22', SourceCidrIp='192.0.2.10/32')
        cloud.side_effect = [{'Instances': {'Instance': [{'InstanceId': 'fixture', 'SecurityGroupIds': {'SecurityGroupId': ['sg-fixture']}}]}}, {'Permissions': {'Permission': [rule]}}]
        self.assertEqual(access.check('fixture', required=True), 0)
        self.assertTrue(all(c.args[0].startswith('Describe') for c in cloud.call_args_list))
