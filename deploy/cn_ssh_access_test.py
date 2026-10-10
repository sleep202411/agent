import contextlib
import io
import ipaddress
import subprocess
import unittest
from unittest.mock import patch
import cn_ssh_access as access


class SshAccessTests(unittest.TestCase):
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
        self.assertIn('192.0.2.10/32', mutation)
        self.assertIn('22/22', mutation)
        self.assertNotIn('0.0.0.0/0', mutation)

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
