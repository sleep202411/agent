import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from release_lock import Lock


class LockTests(unittest.TestCase):
    def test_acquire_rechecks_after_other_operator_releases(self):
        lock = Lock('cn')
        with patch.object(lock, 'read', side_effect=[{'data': {'owner': 'other'}}, None]), patch.object(lock, 'write', return_value=True) as write, patch('release_lock.time.sleep'):
            lock.acquire('mine')
        write.assert_called_once_with(None, 'mine')

    def test_conflict_retries_lookup(self):
        lock = Lock('cn')
        with patch.object(lock, 'read', return_value=None) as read, patch.object(lock, 'write', side_effect=[False, True]), patch('release_lock.time.sleep'):
            lock.acquire('mine')
        self.assertEqual(read.call_count, 2)

    def test_never_expires_other_owner(self):
        lock = Lock('cn')
        with patch.object(lock, 'read', return_value={'data': {'owner': 'old'}}), patch.object(lock, 'write') as write:
            with self.assertRaisesRegex(RuntimeError, 'Timed out'):
                lock.acquire('mine', timeout=0)
            write.assert_not_called()

    def test_release_requires_owner(self):
        lock = Lock('cn')
        with patch.object(lock, 'read', return_value={'data': {'owner': 'other'}}), patch.object(lock, 'write') as write:
            with self.assertRaisesRegex(RuntimeError, 'ownership changed'):
                lock.release('mine')
            write.assert_not_called()

    def test_release_compare_and_swap(self):
        lock = Lock('cn')
        previous = {'metadata': {'resourceVersion': '7'}, 'data': {'owner': 'mine'}}
        with patch.object(lock, 'read', return_value=previous), patch.object(lock, 'call', return_value=subprocess.CompletedProcess([], 0, '{}', '')) as call:
            lock.release('mine')
        body = call.call_args.kwargs['body']
        self.assertEqual(body['metadata']['resourceVersion'], '7')
        self.assertEqual(body['data']['owner'], '')

    def test_permissions_fail_closed(self):
        with patch.object(Lock, 'call', return_value=subprocess.CompletedProcess([], 1, '', 'Forbidden')):
            with self.assertRaises(RuntimeError):
                Lock('cn').read()
            with self.assertRaises(RuntimeError):
                Lock('cn').write(None, 'mine')

    def test_explicit_region_not_current_context(self):
        self.assertIn('218059191361846222-c72d2039c68624a3e8d0dee257a13d451', Lock('cn').command)

    def test_retired_com_stops_before_kubernetes_and_child_process(self):
        with patch('release_lock.subprocess.run') as command:
            with self.assertRaisesRegex(RuntimeError, 'retired; use deploy/deploy-com.sh'):
                Lock('com')
            command.assert_not_called()
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name('release_lock.py')),
             'com', '--', '/must-not-run'],
            env={**os.environ, 'PATH': '/nonexistent', 'FD_REGIONAL_LOCK_COM': 'old-owner'},
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn('retired; use deploy/deploy-com.sh', result.stderr)
        self.assertNotIn('Traceback', result.stderr)

    def test_process_success_release_failure_retain_and_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mock = root / 'kubectl'
            mock.write_text('''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
p=Path(os.environ['LOCK_STORE'])
a=sys.argv
if 'get' in a: print(p.read_text() if p.exists() else '')
else:
 v=json.load(sys.stdin); v['metadata']['resourceVersion']='1'; p.write_text(json.dumps(v)); print('{}')
''')
            mock.chmod(0o755)
            env = {k:v for k,v in os.environ.items() if not k.startswith('FD_REGIONAL_LOCK_')}
            env.update(PATH=str(root)+os.pathsep+env['PATH'], LOCK_STORE=str(root/'state'))
            script = str(Path(__file__).with_name('release_lock.py'))
            def run(*args):
                return subprocess.run([sys.executable, script, *args], env=env, capture_output=True, text=True, timeout=10)
            self.assertEqual(run('cn','--',sys.executable,'-c','pass').returncode,0)
            self.assertEqual(json.loads((root/'state').read_text())['data']['owner'],'')
            self.assertEqual(run('cn','--',sys.executable,'-c','raise SystemExit(3)').returncode,3)
            owner=json.loads((root/'state').read_text())['data']['owner']
            self.assertTrue(owner)
            self.assertNotEqual(run('--recover-owner',owner,'cn').returncode,0)
            env['CONFIRM_REMOTE_RELEASE_STOPPED']='YES'
            self.assertEqual(run('--recover-owner',owner,'cn').returncode,0)
            self.assertEqual(json.loads((root/'state').read_text())['data']['owner'],'')

    def test_two_independent_operators_lookup_only_after_shared_acquisition(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mock = root / 'kubectl'
            mock.write_text('''#!/usr/bin/env python3
import fcntl,json,os,sys
from pathlib import Path
p=Path(os.environ['LOCK_STORE'])
with p.with_suffix('.mutex').open('a') as mutex:
 fcntl.flock(mutex,fcntl.LOCK_EX)
 old=json.loads(p.read_text()) if p.exists() else None
 if 'get' in sys.argv: print(json.dumps(old) if old else '')
 else:
  v=json.load(sys.stdin)
  if ('create' in sys.argv and old) or ('replace' in sys.argv and (not old or old['metadata']['resourceVersion'] != v['metadata']['resourceVersion'])):
   print('Error from server (Conflict)',file=sys.stderr);sys.exit(1)
  v['metadata']['resourceVersion']=str(int(old['metadata']['resourceVersion'])+1 if old else 1)
  p.write_text(json.dumps(v));print('{}')
''')
            mock.chmod(0o755)
            env = {k:v for k,v in os.environ.items() if not k.startswith('FD_REGIONAL_LOCK_')}
            env.update(PATH=str(root)+os.pathsep+env['PATH'], LOCK_STORE=str(root/'state'))
            worker = root/'worker.py'
            worker.write_text('''import time
from pathlib import Path
p=Path(__file__).with_name('image')
Path(__file__).with_name('started').touch()
if not p.exists():
 time.sleep(1)
 with Path(__file__).with_name('builds').open('a') as f:f.write('build\\n')
 p.touch()
''')
            command=[sys.executable,str(Path(__file__).with_name('release_lock.py')),'cn','--',sys.executable,str(worker)]
            first=subprocess.Popen(command,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            import time
            try:
                deadline=time.monotonic()+5
                while not (root/'started').exists() and time.monotonic()<deadline: time.sleep(.02)
                self.assertTrue((root/'started').exists())
                second=subprocess.run(command,env=env,capture_output=True,text=True,timeout=30)
                self.assertEqual(second.returncode,0,second.stderr)
                self.assertIn('waiting before image lookup',second.stdout)
                first.communicate(timeout=5)
                self.assertEqual(first.returncode,0)
                self.assertEqual((root/'builds').read_text().splitlines(),['build'])
            finally:
                if first.poll() is None: first.kill();first.communicate()


if __name__ == '__main__':
    unittest.main()
