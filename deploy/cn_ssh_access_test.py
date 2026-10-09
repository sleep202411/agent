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
