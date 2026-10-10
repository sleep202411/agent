#!/usr/bin/env python3
"""Read-only operator IPv4/SSH security-group diagnosis for the CN builder."""
import argparse
import os
import ipaddress
import json
import subprocess
import sys


def cloud(action, *args):
    result = subprocess.run(
        ['aliyun', 'ecs', action, *args, '--RegionId', 'cn-hangzhou', '--profile', 'default'],
        capture_output=True, text=True, check=True, timeout=20,
    )
    return json.loads(result.stdout)


def allows_ssh(rule, address):
    if (rule.get('Direction', 'ingress').lower() != 'ingress'
            or rule.get('Policy', '').lower() != 'accept'
            or rule.get('IpProtocol', '').lower() not in ('tcp', 'all')):
        return False
    ports = rule.get('PortRange', '')
    if ports != '-1/-1':
        low, high = map(int, ports.split('/'))
        if not low <= 22 <= high:
            return False
    cidr = rule.get('SourceCidrIp')
    return bool(cidr and address in ipaddress.ip_network(cidr, strict=False))


def check(instance, required=False):
    authorize = os.environ.get("CN_AUTHORIZE_CURRENT_IP") == "YES"
    try:
        result = subprocess.run(
            ['curl', '-4', '-fsS', '--connect-timeout', '5', '--max-time', '10', 'https://api.ipify.org'],
            capture_output=True, text=True, check=True, timeout=12,
        )
        address = ipaddress.IPv4Address(result.stdout.strip())
        data = cloud('DescribeInstances', '--InstanceIds', json.dumps([instance]))
        instances = data['Instances']['Instance']
        if len(instances) != 1 or instances[0]['InstanceId'] != instance:
            raise ValueError('unexpected instance')
        groups = instances[0]['SecurityGroupIds']['SecurityGroupId']
        if not groups:
            raise ValueError('missing security groups')
        for group in groups:
            data = cloud('DescribeSecurityGroupAttribute', '--SecurityGroupId', group)
            if any(allows_ssh(rule, address) for rule in data['Permissions']['Permission']):
                print(f'==> CN SSH: current operator IPv4 {address} has a matching ingress allow rule')
                return 0
        if authorize:
            group = os.environ.get('CN_SSH_SECURITY_GROUP')
            if not group or group not in groups:
                raise ValueError('Set CN_SSH_SECURITY_GROUP to an attached builder security group before authorizing access')
            cloud('AuthorizeSecurityGroup', '--SecurityGroupId', group,
                  '--Permissions.1.IpProtocol', 'tcp', '--Permissions.1.PortRange', '22/22',
                  '--Permissions.1.SourceCidrIp', str(address) + '/32',
                  '--Permissions.1.Policy', 'accept',
                  '--Permissions.1.Description', 'CN deployment operator SSH')
            data = cloud('DescribeSecurityGroupAttribute', '--SecurityGroupId', group)
            if not any(allows_ssh(rule, address) for rule in data['Permissions']['Permission']):
                raise ValueError('SSH authorization was not visible after the update; retry the precheck')
            print(f'==> CN SSH: authorized and verified {address}/32 TCP/22 in {group}')
            return 0
        print(f'FATAL: CN build ECS SSH allowlist has no TCP/22 ingress allow rule for current operator '
              f'IPv4 {address}/32. Add this exact approved CIDR to an attached security group '
              f'({", ".join(groups)}) in default / cn-hangzhou, then retry. '
              'No access rules were changed automatically.', file=sys.stderr)
        return 2
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError) as error:
        if required or authorize:
            detail = str(error) if isinstance(error, ValueError) else type(error).__name__
            print(f'FATAL: CN SSH access precheck failed ({detail}); no release lock acquired by this precheck.', file=sys.stderr)
            return 2
        # API permissions and diagnostic connectivity are separate from SSH access.
        print('WARNING: CN SSH allowlist diagnosis unavailable; SSH readiness checks will still run.',
              file=sys.stderr)
        return 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('instance')
    parser.add_argument('--required', action='store_true')
    args = parser.parse_args()
    sys.exit(check(args.instance, required=args.required))
