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
        {"AccountId": "5332868355276356"},
        {"cluster_id": preflight.TARGET["clusterId"], "name": "fizzdragon-com-sg",
         "region_id": "ap-southeast-1", "state": "running",
         "master_url": json.dumps({"api_server_endpoint": "https://ack.example.test:6443"})},
        {"clusters": [{"cluster": {"server": "https://ack.example.test:6443/"}}]},
        {"metadata": {"name": "fizzdragon", "uid": "namespace-fixture"},
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

    def test_correct_account_and_endpoint_use_only_explicit_read_commands(self):
        result, read = self.verify(metadata())
        self.assertTrue(result["cloudIdentityVerified"])
        self.assertTrue(result["kubeconfigEndpointVerified"])
        self.assertFalse(result["secretsRead"])
        self.assertFalse(result["mutationsPerformed"])
        self.assertFalse(result["deploymentReady"])
        self.assertEqual(result["namespaceUid"], "namespace-fixture")
        self.assertEqual(result["storageClasses"][0]["name"], "fixture-disk")
        calls = [call.args[0] for call in read.call_args_list]
        self.assertEqual(calls[:2], [
            ["aliyun", "sts", "GetCallerIdentity", "--profile", "acct6", "--region", "ap-southeast-1"],
            ["aliyun", "cs", "GET", f"/clusters/{preflight.TARGET['clusterId']}",
             "--profile", "acct6", "--region", "ap-southeast-1"],
        ])
        self.assertEqual([call[5:] for call in calls[2:]], [
            ["config", "view", "--minify", "-o", "json"],
            ["get", "namespace", "fizzdragon", "-o", "json"],
            ["get", "storageclass", "-o", "json"],
        ])
        self.assertTrue(all(call[1:5] == ["--kubeconfig", "/private/fixture-kubeconfig",
                                        "--namespace", "fizzdragon"] for call in calls[2:]))

    def test_wrong_account_stops_before_cluster_or_kube_access(self):
        with patch.object(preflight, "read_json", return_value={"AccountId": "5941647929258385"}) as read:
            with self.assertRaisesRegex(preflight.PreflightError, "stopped before cluster access"):
                preflight.verify("unused")
        self.assertEqual(read.call_count, 1)

    def test_wrong_cluster_identity_or_state_stops_before_kube_access(self):
        for key, value in [("cluster_id", "other"), ("name", "other"),
                           ("region_id", "cn-hangzhou"), ("state", "initial")]:
            with self.subTest(key=key):
                responses = metadata()
                responses[1][key] = value
                with patch.object(preflight, "read_json", side_effect=responses) as read:
                    with self.assertRaises(preflight.PreflightError):
                        preflight.verify("unused")
                self.assertEqual(read.call_count, 2)

    def test_untrusted_kube_endpoint_or_tls_stops_before_remote_kube_requests(self):
        invalid = [
            {"server": "https://other.example.test:6443"},
            {"server": "http://ack.example.test:6443"},
            {"server": "https://token@ack.example.test:6443"},
            {"server": "https://ack.example.test:6443?token=hidden"},
            {"server": "https://ack.example.test:6443", "insecure-skip-tls-verify": True},
            {"server": "https://ack.example.test:6443", "proxy-url": "https://proxy.example.test"},
        ]
        for cluster in invalid:
            with self.subTest(cluster=cluster):
                responses = metadata()
                responses[2]["clusters"][0]["cluster"] = cluster
                with patch.object(preflight, "read_json", side_effect=responses) as read:
                    with self.assertRaises(preflight.PreflightError):
                        preflight.verify("unused")
                self.assertEqual(read.call_count, 3)

    def test_empty_or_malformed_cloud_endpoints_fail_closed(self):
        for endpoints in [None, "invalid", "{}", {}, [], {"api": "http://ack.example.test"},
                          {"api": ""}, {"api": 42}]:
            with self.subTest(endpoints=endpoints):
                responses = metadata()
                responses[1]["master_url"] = endpoints
                with patch.object(preflight, "read_json", side_effect=responses) as read:
                    with self.assertRaises(preflight.PreflightError):
                        preflight.verify("unused")
                self.assertEqual(read.call_count, 2)

    def test_missing_ambiguous_or_inactive_namespace_is_rejected(self):
        for replacement in [{"metadata": {"name": "other", "uid": "x"}},
                            {"metadata": {"name": "fizzdragon"}},
                            {"metadata": {"name": "fizzdragon", "uid": {"hidden": "value"}}},
                            {"metadata": {"name": "fizzdragon", "uid": "x", "deletionTimestamp": "now"}},
                            {"metadata": {"name": "fizzdragon", "uid": "x"}, "status": {"phase": "Terminating"}}]:
            responses = metadata()
            responses[3] = replacement
            with patch.object(preflight, "read_json", side_effect=responses) as read:
                with self.assertRaises(preflight.PreflightError):
                    preflight.verify("unused")
            self.assertEqual(read.call_count, 4)

    def test_cli_errors_and_bad_json_do_not_disclose_raw_output(self):
        for result in [subprocess.CompletedProcess([], 1, "credential-secret", "signed-url-secret"),
                       subprocess.CompletedProcess([], 0, "credential-secret", ""),
                       subprocess.CompletedProcess([], 0, "[]", "")]:
            with patch.object(preflight.subprocess, "run", return_value=result):
                with self.assertRaises(preflight.PreflightError) as error:
                    preflight.read_json(["aliyun", "sts", "GetCallerIdentity"])
            self.assertNotIn("credential-secret", str(error.exception))
            self.assertNotIn("signed-url-secret", str(error.exception))

    def test_malformed_storageclass_metadata_fails_closed(self):
        for invalid in [{}, {"items": None}, {"items": {}}, {"items": [None]},
                        {"items": [{}]}, {"items": [{"metadata": {"name": "x"}}]},
                        {"items": [{"metadata": {"name": "x"}, "provisioner": {"bad": "value"}}]},
                        {"items": [{"metadata": {"name": "x"}, "provisioner": "p", "reclaimPolicy": {"bad": "value"}}]}]:
            with self.subTest(invalid=invalid):
                responses = metadata()
                responses[4] = invalid
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
