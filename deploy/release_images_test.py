import json
import os
import sys
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock
import release_images as images
import cn_release as release
import argparse


class InputTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.git('init', '-b', 'main')
        self.git('config', 'user.name', 'Test')
        self.git('config', 'user.email', 'test@example.invalid')
        self.git('config', 'core.hooksPath', '/dev/null')
        for path, content in {
            'apps/web/source.ts': 'web', 'apps/server/source.ts': 'server',
            'apps/studio/source.ts': 'studio', 'packages/shared/index.ts': 'shared',
            'package-lock.json': '{}', 'apps/server/package.json': '{}',
            'apps/web/.env.production.cn': 'cn', 'apps/web/.env.production.com': 'com',
            'deploy/cn-remote-build-services.sh': 'docker build',
        }.items(): self.write(path, content)
        self.source = self.commit()
    def git(self, *args):
        return images.git(self.root, *args).decode().strip()
    def write(self, path, value):
        dest = self.root / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(value)
    def commit(self):
        self.git('add', '.')
        self.git('commit', '-m', 'fixture')
        return self.git('rev-parse', 'HEAD')
    def compare(self, path, expected, service='web', region='cn'):
        self.write(path, '{"version":"2"}' if path.endswith('.json') else 'changed')
        newer = self.commit()
        self.assertEqual(images.inputs(self.root, self.source, service, region) == images.inputs(self.root, newer, service, region), expected)
    def test_other_service_change_reuses_web(self): self.compare('apps/server/source.ts', True)
    def test_web_change_rebuilds_web(self): self.compare('apps/web/source.ts', False)
    def test_shared_dependency_rebuilds(self): self.compare('packages/shared/index.ts', False)
    def test_lockfile_rebuilds(self): self.compare('package-lock.json', False)
    def test_workspace_manifest_rebuilds(self): self.compare('apps/server/package.json', False)
    def test_documentation_does_not_rebuild(self): self.compare('docs/release.md', True)
    def test_chart_does_not_rebuild_images(self): self.compare('deploy/helm/values.yaml', True)
    def test_com_env_does_not_invalidate_cn(self): self.compare('apps/web/.env.production.com', True)
    def test_cn_env_invalidates_studio(self): self.compare('apps/web/.env.production.cn', False, 'studio', 'cn')
    def test_cn_recipe_change_invalidates(self): self.compare('deploy/cn-remote-build-services.sh', False, region='cn')
    def test_game_agent_source_invalidates_its_cn_image(self):
        self.write('apps/game-agent/package.json', '{"name":"game-agent","dependencies":{"@repo/shared":"*"}}')
        self.write('packages/shared/package.json', '{"name":"@repo/shared"}')
        self.source = self.commit()
        self.compare('apps/game-agent/source.ts', False, 'game-agent')
    def test_game_agent_does_not_rebuild_for_other_app_source(self):
        self.write('apps/game-agent/package.json', '{"name":"game-agent"}')
        self.source = self.commit()
        self.compare('apps/web/source.ts', True, 'game-agent')
    def test_existing_image_from_another_operator_is_reused(self):
        self.write('docs/new.md', 'docs')
        source = self.commit()
        digest = 'sha256:' + 'a' * 64
        with patch.object(images, 'candidates', return_value=[(self.source, digest)]), patch.object(images, 'digest', return_value=digest):
            self.assertEqual(images.find(self.root, source, 'cn', 'web'), {'tag': self.source, 'digest': digest})
    def test_changed_application_is_not_reused(self):
        self.write('apps/web/source.ts', 'new app')
        source = self.commit()
        with patch.object(images, 'candidates', return_value=[(self.source, 'sha256:'+'a'*64)]), patch.object(images, 'digest') as read:
            self.assertIsNone(images.find(self.root, source, 'cn', 'web'))
            read.assert_not_called()
    def test_overwritten_registry_tag_is_not_reused(self):
        with patch.object(images, 'candidates', return_value=[(self.source, 'sha256:'+'a'*64)]), patch.object(images, 'digest', return_value='sha256:'+'b'*64):
            with self.assertRaisesRegex(RuntimeError, 'changed in the registry'):
                images.find(self.root, self.source, 'cn', 'web')
    def test_registry_failure_is_not_cache_miss(self):
        with patch.object(images, 'candidates', side_effect=RuntimeError('Forbidden')):
            with self.assertRaises(RuntimeError): images.find(self.root, self.source, 'cn', 'web')


class RetiredComTests(unittest.TestCase):
    def test_public_helpers_reject_com_before_git_or_cloud_lookup(self):
        with patch.object(images, 'git') as git, patch.object(images, 'query') as cloud, \
                patch.object(images, 'verify') as verify:
            operations = [
                lambda: images.inputs(Path('/missing'), 'a'*40, 'web', 'com'),
                lambda: images.candidates('com', 'web'),
                lambda: images.digest('com', 'web', 'a'*40),
                lambda: images.find(Path('/missing'), 'a'*40, 'com', 'web'),
            ]
            for operation in operations:
                with self.assertRaisesRegex(RuntimeError, 'retired; use deploy/deploy-com.sh'):
                    operation()
            git.assert_not_called(); cloud.assert_not_called(); verify.assert_not_called()

    def test_cli_rejects_com_without_any_available_cloud_or_git_tool(self):
        result = subprocess.run(
            [sys.executable, str(Path(images.__file__)), 'com', '/missing', 'a'*40, 'web'],
            env={**os.environ, 'PATH': '/nonexistent'}, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn('retired; use deploy/deploy-com.sh', result.stderr)
        self.assertNotIn('Traceback', result.stderr)


class CoordinatorTests(unittest.TestCase):
    def test_only_changed_service_builds_and_old_tags_reach_deployment(self):
        source, old = 'a'*40, 'b'*40
        state = dict(tag=source, services=['server','web'], namespace='fizzdragon', release='fizzdragon')
        args = argparse.Namespace(backup_id=None, allow_chart_update=True)
        with patch.object(release, 'revision', side_effect=lambda x:x), patch.object(release, 'latest_source', return_value=source), patch.object(release, 'get_job', return_value=None), patch.object(release, 'find_image', side_effect=lambda root, tag, region, svc: {'tag':old,'digest':'server-digest'} if svc=='server' else None), patch.object(release, 'verify', side_effect=lambda tag, svcs:{svcs[0]:svcs[0]+'-digest'}), patch.object(release, 'run') as run, patch.object(release, 'migration'):
            release.run_cycles(state,args,Mock())
            builds=[c for c in run.call_args_list if '--build-only' in c.args]
            self.assertEqual(len(builds),1)
            self.assertEqual(builds[0].args[-1], 'web')
            self.assertNotIn('server', builds[0].args)
            deployed=[c for c in run.call_args_list if '--deploy-only' in c.args][0]
            self.assertEqual(json.loads(deployed.kwargs['env']['CN_RELEASE_IMAGE_TAGS']), {'server':old,'web':source})
            self.assertTrue(state['complete'])
    def test_all_reused_services_do_not_start_builder(self):
        source='a'*40
        state=dict(tag=source,services=['web'],namespace='fizzdragon',release='fizzdragon')
        with patch.object(release, 'revision', side_effect=lambda x:x), patch.object(release, 'latest_source', return_value=source), patch.object(release, 'find_image', return_value={'tag':source,'digest':'digest'}), patch.object(release, 'verify', return_value={'web':'digest'}), patch.object(release, 'run') as run:
            release.run_cycles(state,argparse.Namespace(backup_id=None,allow_chart_update=True),Mock())
            self.assertFalse(any('--build-only' in c.args for c in run.call_args_list))
            self.assertTrue(any('--deploy-only' in c.args for c in run.call_args_list))

class DependencyTests(InputTests):
    def test_unused_shared_package_code_does_not_rebuild(self):
        self.write('apps/web/package.json', '{"name":"web","dependencies":{"@repo/shared":"*"}}')
        self.write('packages/shared/package.json', '{"name":"@repo/shared"}')
        self.write('packages/unused/package.json', '{"name":"@repo/unused"}')
        self.write('packages/unused/index.ts', 'old')
        self.source = self.commit()
        self.compare('packages/unused/index.ts', True)
    def test_transitive_workspace_code_invalidates(self):
        self.write('apps/web/package.json', '{"name":"web","dependencies":{"@repo/shared":"*"}}')
        self.write('packages/shared/package.json', '{"name":"@repo/shared","dependencies":{"@repo/nested":"*"}}')
        self.write('packages/nested/package.json', '{"name":"@repo/nested"}')
        self.write('packages/nested/index.ts', 'old')
        self.source = self.commit()
        self.compare('packages/nested/index.ts', False)

class DeploymentBoundaryTests(unittest.TestCase):
    def test_reused_image_must_match_source_inputs(self):
        import verify_release_image as boundary
        with patch.object(boundary,'git'), patch.object(boundary,'inputs',side_effect=['new','old']), patch.object(boundary,'verify') as verify:
            with self.assertRaisesRegex(RuntimeError,'does not match'):
                boundary.check(Path('/fixture'),'a'*40,'web','b'*40)
            verify.assert_not_called()
    def test_changed_digest_blocks_deployment(self):
        import verify_release_image as boundary
        with patch.object(boundary,'verify',return_value={'web':'changed'}), patch.dict(boundary.os.environ,{'CN_RELEASE_IMAGE_DIGESTS':'{"web":"expected"}'}):
            with self.assertRaisesRegex(RuntimeError,'digest changed'):
                boundary.check(Path('/fixture'),'a'*40,'web','a'*40)

class PaginationTests(unittest.TestCase):
    def test_cn_registry_reads_all_pages(self):
        repo={'TotalCount':1,'Repositories':[{'RepoName':'fizzdragon-web','RepoNamespaceName':'fizzdragon','InstanceId':images.INSTANCE,'RepoStatus':'NORMAL','RepoId':'repo'}]}
        row={'Status':'NORMAL','Tag':'a'*40,'Digest':'b'*64}
        with patch.object(images,'query',side_effect=[repo,{'TotalCount':101,'Images':[row]*100},{'TotalCount':101,'Images':[row]}]) as calls:
            self.assertEqual(len(images.candidates('cn','web')),101)
            self.assertEqual(calls.call_args.kwargs['PageNo'],2)
