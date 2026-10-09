import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "harness-preflight.py"
SPEC = importlib.util.spec_from_file_location("harness_preflight", SCRIPT)
preflight = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(preflight)


def metadata():
    return [
        {"clusters": [{"cluster": {"server": "https://10.80.22.97:6443/"}}]},
        {"metadata": {"name": "fizzdragon", "uid": preflight.NAMESPACE_UID},
         "status": {"phase": "Active"}},
        {"items": [{"metadata": {"name": "fixture-disk"},
                    "provisioner": "diskplugin.csi.alibabacloud.com",
                    "reclaimPolicy": "Retain", "volumeBindingMode": "WaitForFirstConsumer"}]},
    ]


class HarnessPreflightTest(unittest.TestCase):
    def verify(self, responses):
        with patch.object(preflight, "read_json", side_effect=responses) as read:
            result = preflight.verify("/private/fixture-kubeconfig")
        return result, read

    def test_native_credentials_verify_target_without_cloud_keys_or_secret_reads(self):
        result, read = self.verify(metadata())
        self.assertTrue(result["clusterIdentityVerified"])
        self.assertTrue(result["kubeconfigEndpointVerified"])
        self.assertFalse(result["secretsRead"])
        self.assertFalse(result["mutationsPerformed"])
        self.assertFalse(result["deploymentReady"])
        self.assertEqual(result["namespaceUid"], preflight.NAMESPACE_UID)
        self.assertEqual(result["storageClasses"][0]["name"], "fixture-disk")
        calls = [call.args[0] for call in read.call_args_list]
        self.assertEqual([call[5:] for call in calls], [
            ["config", "view", "--minify", "-o", "json"],
            ["get", "namespace", "fizzdragon", "-o", "json"],
            ["get", "storageclass", "-o", "json"],
        ])
        self.assertTrue(all(call[:5] == ["kubectl", "--kubeconfig", "/private/fixture-kubeconfig",
                                        "--namespace", "fizzdragon"] for call in calls))

    def test_reviewed_public_endpoint_is_also_supported(self):
        responses = metadata()
        responses[0]["clusters"][0]["cluster"]["server"] = "https://8.222.158.175:6443"
        self.assertTrue(self.verify(responses)[0]["clusterIdentityVerified"])

    def test_untrusted_kube_endpoint_or_tls_stops_before_remote_kube_requests(self):
        invalid = [
            {"server": "https://other.example.test:6443"},
            {"server": "http://10.80.22.97:6443"},
            {"server": "https://token@10.80.22.97:6443"},
            {"server": "https://10.80.22.97:6443?token=hidden"},
            {"server": "https://10.80.22.97:6443", "insecure-skip-tls-verify": True},
            {"server": "https://10.80.22.97:6443", "proxy-url": "https://proxy.example.test"},
        ]
        for cluster in invalid:
            with self.subTest(cluster=cluster):
                responses = metadata()
                responses[0]["clusters"][0]["cluster"] = cluster
                with patch.object(preflight, "read_json", side_effect=responses) as read:
                    with self.assertRaises(preflight.PreflightError):
                        preflight.verify("unused")
                self.assertEqual(read.call_count, 1)

    def test_missing_or_multiple_selected_clusters_fail_closed(self):
        for config in [{}, {"clusters": []}, {"clusters": [{"cluster": {}}, {"cluster": {}}]}]:
            with self.subTest(config=config), patch.object(preflight, "read_json", return_value=config) as read:
                with self.assertRaises(preflight.PreflightError):
                    preflight.verify("unused")
                self.assertEqual(read.call_count, 1)

    def test_missing_ambiguous_or_inactive_namespace_is_rejected(self):
        for replacement in [{"metadata": {"name": "other", "uid": "x"}},
                            {"metadata": {"name": "fizzdragon"}},
                            {"metadata": {"name": "fizzdragon", "uid": {"hidden": "value"}}},
                            {"metadata": {"name": "fizzdragon", "uid": "x", "deletionTimestamp": "now"}},
                            {"metadata": {"name": "fizzdragon", "uid": "x"}, "status": {"phase": "Terminating"}}]:
            responses = metadata()
            responses[1] = replacement
            with patch.object(preflight, "read_json", side_effect=responses) as read:
                with self.assertRaises(preflight.PreflightError):
                    preflight.verify("unused")
            self.assertEqual(read.call_count, 2)

    def test_cli_errors_and_bad_json_do_not_disclose_raw_output(self):
        for result in [subprocess.CompletedProcess([], 1, "credential-secret", "signed-url-secret"),
                       subprocess.CompletedProcess([], 0, "credential-secret", ""),
                       subprocess.CompletedProcess([], 0, "[]", "")]:
            with patch.object(preflight.subprocess, "run", return_value=result):
                with self.assertRaises(preflight.PreflightError) as error:
                    preflight.read_json(["kubectl", "get", "namespace"])
            self.assertNotIn("credential-secret", str(error.exception))
            self.assertNotIn("signed-url-secret", str(error.exception))

    def test_malformed_storageclass_metadata_fails_closed(self):
        for invalid in [{}, {"items": None}, {"items": {}}, {"items": [None]},
                        {"items": [{}]}, {"items": [{"metadata": {"name": "x"}}]},
                        {"items": [{"metadata": {"name": "x"}, "provisioner": {"bad": "value"}}]},
                        {"items": [{"metadata": {"name": "x"}, "provisioner": "p", "reclaimPolicy": {"bad": "value"}}]}]:
            with self.subTest(invalid=invalid):
                responses = metadata()
                responses[2] = invalid
                with self.assertRaises(preflight.PreflightError):
                    self.verify(responses)

    def test_unexpected_metadata_error_is_redacted_by_entry_point(self):
        with patch.object(preflight.sys, "argv", ["harness-preflight.py", "--kubeconfig", "fixture"]), \
                patch.object(preflight, "verify", side_effect=ValueError("private-input")), \
                contextlib.redirect_stderr(io.StringIO()) as output:
            result = preflight.main()
        self.assertEqual(result, 1)
        self.assertNotIn("private-input", output.getvalue())


if __name__ == "__main__":
    unittest.main()
