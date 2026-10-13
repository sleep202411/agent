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
    def setUp(self):
        self.cache = tempfile.TemporaryDirectory()
        self.addCleanup(self.cache.cleanup)
        p = patch.object(auth, 'cache_directory', return_value=Path(self.cache.name))
        p.start()
        self.addCleanup(p.stop)

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

    def test_reuses_previous_pair_until_expired(self):
        with tempfile.TemporaryDirectory() as tmp:
            second = self.token()
            second.update(TempUsername='new-user', AuthorizationToken='new-token')
            with patch.object(auth, 'query', side_effect=[self.token(), second]) as query:
                auth.prepare(tmp)
                auth.prepare(tmp)
            self.assertEqual(query.call_count, 1)
            self.assertEqual((Path(tmp) / 'acr-password.txt').read_text(), 'private-token')
            self.assertEqual((Path(tmp) / 'acr-username.txt').read_text(), 'fixture-user')

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

    def test_preflight_and_build_share_cache(self):
        with patch.object(auth, 'query', return_value=self.token()) as query:
            auth.prepare()
            with tempfile.TemporaryDirectory() as tmp:
                auth.prepare(tmp)
            self.assertEqual(query.call_count, 1)

    def test_expiry_refreshes_but_near_expiry_does_not(self):
        now = time.time()
        with patch.object(auth.time, 'time', return_value=now), patch.object(auth, 'query', return_value=self.token()) as query:
            auth.prepare()
            with patch.object(auth.time, 'time', return_value=now + 3500):
                with self.assertRaisesRegex(RuntimeError, 'retry after expiry'):
                    auth.prepare()
            self.assertEqual(query.call_count, 1)
            renewed = self.token()
            renewed['ExpireTime'] = int((now + 8000) * 1000)
            query.return_value = renewed
            with patch.object(auth.time, 'time', return_value=now + 3601):
                auth.prepare()
            self.assertEqual(query.call_count, 2)
