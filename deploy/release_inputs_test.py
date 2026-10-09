import copy
import unittest
from release_inputs import dependency_snapshot


class DependencySnapshotTests(unittest.TestCase):
    def setUp(self):
        self.lock = {'lockfileVersion': 3, 'packages': {
            '': {'devDependencies': {'typescript': '5'}},
            'apps/web': {'dependencies': {'react': '19', '@repo/shared': '*'}},
            'apps/mobile': {'dependencies': {'expo-location': '57'}},
            'node_modules/typescript': {'version': '5', 'integrity': 'ts'},
            'node_modules/react': {'version': '19', 'integrity': 'react'},
            'node_modules/expo-location': {'version': '57', 'integrity': 'expo'},
            'node_modules/@repo/shared': {'link': True, 'resolved': 'packages/shared'},
            'packages/shared': {'dependencies': {'nested': '1'}},
            'node_modules/nested': {'version': '1', 'integrity': 'nested'},
        }}

    def snapshot(self, lock):
        result = dependency_snapshot(lock, {'apps/web', 'packages/shared'})
        self.assertIsNotNone(result)
        return result

    def test_mobile_only_removal_leaves_web_unchanged(self):
        changed = copy.deepcopy(self.lock)
        del changed['packages']['node_modules/expo-location']
        changed['packages']['apps/mobile']['dependencies'] = {}
        self.assertEqual(self.snapshot(self.lock), self.snapshot(changed))

    def test_transitive_integrity_change_invalidates(self):
        changed = copy.deepcopy(self.lock)
        changed['packages']['node_modules/nested']['integrity'] = 'different'
        self.assertNotEqual(self.snapshot(self.lock), self.snapshot(changed))

    def test_root_build_tool_change_invalidates(self):
        changed = copy.deepcopy(self.lock)
        changed['packages']['node_modules/typescript']['version'] = '6'
        self.assertNotEqual(self.snapshot(self.lock), self.snapshot(changed))

    def test_nested_install_changes_actual_resolution(self):
        changed = copy.deepcopy(self.lock)
        changed['packages']['apps/web/node_modules/react'] = {'version': '19.1'}
        self.assertNotEqual(self.snapshot(self.lock), self.snapshot(changed))

    def test_peer_and_optional_dependencies_are_traversed(self):
        for kind in ['peerDependencies', 'optionalDependencies']:
            old = copy.deepcopy(self.lock)
            old['packages']['node_modules/react'][kind] = {'nested': '1'}
            old['packages']['node_modules/react/node_modules/nested'] = {'version': '2'}
            self.assertIn('node_modules/react/node_modules/nested', self.snapshot(old)['packages'])

    def test_missing_optional_peer_is_supported_and_later_install_changes_identity(self):
        old = copy.deepcopy(self.lock)
        old['packages']['node_modules/react']['peerDependencies'] = {'missing': '*'}
        before = self.snapshot(old)
        old['packages']['node_modules/missing'] = {'version': '1'}
        self.assertNotEqual(before, self.snapshot(old))

    def test_missing_required_dependency_falls_back(self):
        del self.lock['packages']['node_modules/nested']
        self.assertIsNone(dependency_snapshot(self.lock, {'apps/web', 'packages/shared'}))

    def test_unknown_lock_format_falls_back(self):
        self.assertIsNone(dependency_snapshot({'lockfileVersion': 1}, {'apps/web'}))

    def test_link_target_integrity_is_included(self):
        self.assertIn('packages/shared', self.snapshot(self.lock)['packages'])
