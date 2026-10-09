import contextlib
import io
import stat
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import cn_build_credentials as auth


class CredentialsTests(unittest.TestCase):
    def token(self, **changes):
        return dict(TempUsername='fixture-user', AuthorizationToken='private-token',
                    ExpireTime=int((time.time() + 3600) * 1000), **changes)

    def test_private_files_and_no_secret_output(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(auth, 'query', return_value=self.token()) as query:
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                auth.prepare(tmp)
            query.assert_called_once_with('GetAuthorizationToken')
            for filename, content in [('acr-username.txt', 'fixture-user'), ('acr-password.txt', 'private-token')]:
                file = Path(tmp) / filename
                self.assertEqual(file.read_text(), content)
                self.assertEqual(stat.S_IMODE(file.stat().st_mode), 0o600)
                self.assertNotIn(content, output.getvalue())

    def test_refresh_replaces_previous_pair(self):
        with tempfile.TemporaryDirectory() as tmp:
            second = self.token()
            second.update(TempUsername='new-user', AuthorizationToken='new-token')
            with patch.object(auth, 'query', side_effect=[self.token(), second]) as query:
                auth.prepare(tmp)
                auth.prepare(tmp)
            self.assertEqual(query.call_count, 2)
            self.assertEqual((Path(tmp) / 'acr-password.txt').read_text(), 'new-token')
            self.assertEqual((Path(tmp) / 'acr-username.txt').read_text(), 'new-user')

    def test_invalid_credentials_do_not_replace_existing_files(self):
        for change in [{'ExpireTime': 0}, {'ExpireTime': 'bad'}, {'ExpireTime': int(time.time()*1000)+60000},
                       {'AuthorizationToken': ''}, {'TempUsername': None}, {'AuthorizationToken': 'secret\nextra'}]:
            with self.subTest(change=next(iter(change))), tempfile.TemporaryDirectory() as tmp:
                target = Path(tmp) / 'acr-password.txt'
                target.write_text('previous')
                data = self.token(); data.update(change)
                with patch.object(auth, 'query', return_value=data), self.assertRaises(RuntimeError):
                    auth.prepare(tmp)
                self.assertEqual(target.read_text(), 'previous')

    def test_acquisition_failure_does_not_reuse_saved_token(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(auth, 'query', side_effect=RuntimeError('Denied')):
            target = Path(tmp) / 'acr-password.txt'; target.write_text('previous')
            with self.assertRaisesRegex(RuntimeError, 'Denied'):
                auth.prepare(tmp)
            self.assertEqual(target.read_text(), 'previous')

    def test_preflight_acquires_without_writing_files(self):
        with patch.object(auth, 'query', return_value=self.token()), patch.object(auth.tempfile, 'mkstemp') as create:
            auth.prepare()
            create.assert_not_called()


if __name__ == '__main__':
    unittest.main()
