#!/usr/bin/env python3
"""Read-only operator IPv4/SSH security-group diagnosis for the CN builder."""
import argparse
import os
import ipaddress
import json
import subprocess
import sys
import time


def failure_detail(error):
    """Classify without exposing signed CLI requests or credential values."""
    if isinstance(error, subprocess.TimeoutExpired):
        return 'request timed out', True
    detail = str(getattr(error, 'stderr', '') or '').lower()
    if any(value in detail for value in ('accessdenied', 'forbidden', 'unauthorized',
                                         'invalidaccesskey', 'signaturedoesnotmatch')):
        return 'cloud authorization rejected', False
    if any(value in detail for value in ('no such host', 'could not resolve',
                                         'temporary failure in name resolution')):
        return 'DNS lookup failed', True
    if any(value in detail for value in ('timed out', 'timeout', 'connection reset',
                                         'connection refused', 'network is unreachable',
                                         'tls handshake', 'unexpected eof')):
        return 'network connection failed', True
    if isinstance(error, subprocess.CalledProcessError):
        return 'command exited with status ' + str(error.returncode), False
    return type(error).__name__, False


def request(args, label, retry_read=False, timeout=20):
    for attempt in range(3 if retry_read else 1):
        try:
            return subprocess.run(args, capture_output=True, text=True, check=True, timeout=timeout)
        except (OSError, subprocess.SubprocessError) as error:
            reason, transient = failure_detail(error)
            if not retry_read or not transient or attempt == 2:
                raise RuntimeError(label + ': ' + reason) from None
            delay = (2, 5)[attempt]
            print(f'==> {label}: {reason}; retry {attempt + 2}/3 in {delay}s', file=sys.stderr)
            time.sleep(delay)


def cloud(action, *args):
    result = request(
        ['aliyun', 'ecs', action, *args, '--RegionId', 'cn-hangzhou', '--profile', 'default'],
        'CN ECS ' + action, retry_read=action.startswith('Describe'),
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
        result = request(
            ['curl', '-4', '-fsS', '--connect-timeout', '5', '--max-time', '10', 'https://api.ipify.org'],
            'CN operator IPv4 lookup', retry_read=True, timeout=12,
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
    except (OSError, subprocess.SubprocessError, RuntimeError, ValueError, KeyError, TypeError) as error:
        if required or authorize:
            detail = str(error) if isinstance(error, (RuntimeError, ValueError)) else failure_detail(error)[0]
            print(f'FATAL: CN SSH access precheck failed ({detail}); release lock ownership is unchanged.', file=sys.stderr)
            return 2
        # API permissions and diagnostic connectivity are separate from SSH access.
        print('WARNING: CN SSH allowlist diagnosis unavailable; SSH readiness checks will still run.',
              file=sys.stderr)
        return 0


def stop_builder(instance):
    """Only called once remote work has a known outcome; reconcile lost stop replies."""
    for attempt in range(3):
        try:
            rows = cloud('DescribeInstanceStatus', '--InstanceId.1', instance)['InstanceStatuses']['InstanceStatus']
            if len(rows) != 1 or rows[0].get('InstanceId') != instance:
                raise ValueError('unexpected builder status response')
            state = rows[0]['Status']
            if state in ('Stopped', 'Stopping'):
                return 0
            if state != 'Running':
                raise ValueError('builder is not Running: ' + str(state))
            cloud('StopInstance', '--InstanceId', instance, '--StoppedMode', 'StopCharging')
            return 0
        except (RuntimeError, ValueError, KeyError, TypeError) as error:
            # An uncertain stop response is reconciled by reading state before retry.
            transient = isinstance(error, RuntimeError) and any(
                reason in str(error) for reason in ('DNS lookup failed', 'request timed out', 'network connection failed'))
            if not transient or attempt == 2:
                print(f'WARNING: CN builder {instance} stop unconfirmed ({error}); inspect ECS before retrying.', file=sys.stderr)
                return 2
            time.sleep((2, 5)[attempt])
    return 2


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('instance')
    parser.add_argument('--required', action='store_true')
    parser.add_argument('--stop-builder', action='store_true')
    args = parser.parse_args()
    sys.exit(stop_builder(args.instance) if args.stop_builder else check(args.instance, required=args.required))
