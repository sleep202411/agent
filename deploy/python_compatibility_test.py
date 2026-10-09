import importlib.util
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('python_check', ROOT / 'deploy/check-python.py')
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


class PythonCompatibilityTests(unittest.TestCase):
    def test_old_versions_have_an_actionable_error(self):
        for version in [(2, 7), (3, 7), (3, 8)]:
            self.assertIn('Activate a newer Python environment', check.check(version))

    def test_baseline_and_newer_versions_are_accepted(self):
        for version in [(3, minor) for minor in range(9, 17)]:
            self.assertIsNone(check.check(version))

    def test_entrypoint_imports_without_cloud_access(self):
        for path, args in [
            ('aliyun-sg/deploy-production.py', ['--help']),
            ('cn_release.py', ['release', '--help']),
            ('cn_release.py', ['migrate', '--help']),
        ]:
            result = subprocess.run([sys.executable, str(ROOT / 'deploy' / path), *args],
                                    capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('usage:', result.stdout)
