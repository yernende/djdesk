"""Offline checks for the configurable deployment boundary; never connects to SSH."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('from_actions', Path(__file__).with_name('from-actions.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentSettingsTests(unittest.TestCase):
    def test_explicit_target_and_https_origin(self):
        self.assertEqual(deploy.deployment_settings({
            'DEPLOY_SSH_TARGET': 'app-deploy@deploy.example.com',
            'DEPLOY_PUBLIC_ORIGIN': 'https://djdesk.example.com/',
        }), ('app-deploy@deploy.example.com', 'deploy.example.com', 'https://djdesk.example.com'))

    def test_missing_or_option_like_target_is_rejected(self):
        for target in ('', '-oProxyCommand=bad', 'user@host;id', 'user@host\nvalue'):
            with self.subTest(target=target), self.assertRaises(ValueError):
                deploy.deployment_settings({'DEPLOY_SSH_TARGET': target,
                                            'DEPLOY_PUBLIC_ORIGIN': 'https://example.com'})

    def test_origin_cannot_contain_credentials_or_access_links(self):
        for origin in ('', 'http://example.com', 'https://user:pass@example.com',
                       'https://example.com/#secret', 'https://example.com/?token=x',
                       'https://example.com/path'):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                deploy.deployment_settings({'DEPLOY_SSH_TARGET': 'deploy@host',
                                            'DEPLOY_PUBLIC_ORIGIN': origin})

    def test_only_clean_current_commit_artifact_is_accepted(self):
        metadata = {'release': 'djdesk-20260920T000000Z-' + 'a' * 12,
                    'sha256': 'b' * 64, 'source_commit': 'a' * 40, 'source_dirty': False}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def write(value):
                (root / 'release.json').write_text(json.dumps(value))
            write(metadata)
            self.assertEqual(deploy.checked_metadata(root, 'a' * 40), metadata)
            for change in ({'source_dirty': True}, {'source_commit': 'c' * 40},
                           {'release': '../../bad'}, {'sha256': 'bad'}):
                write({**metadata, **change})
                with self.subTest(change=change), self.assertRaises(ValueError):
                    deploy.checked_metadata(root, 'a' * 40)


if __name__ == '__main__':
    unittest.main()
