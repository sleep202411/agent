import base64
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('secrets_setup', Path(__file__).with_name('cn-game-agent-secrets.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class SecretTests(unittest.TestCase):
    def test_existing_secret_is_not_rotated(self):
        with patch.object(m, 'read', return_value={'data': {'key': 'present'}}), patch.object(m, 'invoke') as call:
            m.ensure('existing', 'key', lambda: self.fail('must not generate'))
            call.assert_not_called()

    def test_missing_key_does_not_overwrite(self):
        with patch.object(m, 'read', return_value={'data': {}}), self.assertRaises(RuntimeError):
            m.ensure('existing', 'key', lambda: b'unused')

    def test_creation_uses_stdin_not_arguments(self):
        with patch.object(m, 'read', return_value=None), patch.object(m, 'invoke') as call:
            m.ensure('missing', 'key', lambda: b'fixture-token')
            self.assertEqual(call.call_args.args[0], ['create', '-f', '-'])
            payload = json.loads(call.call_args.args[1])
            self.assertEqual(base64.b64decode(payload['data']['key']), b'fixture-token')
            self.assertEqual(payload['metadata']['namespace'], 'fizzdragon')

    def test_missing_provider_is_fatal(self):
        with patch.object(m, 'read', return_value=None), self.assertRaises(RuntimeError):
            m.provider_key()
