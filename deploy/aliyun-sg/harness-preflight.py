#!/usr/bin/env python3
"""Read-only identity/endpoint checks for the existing Singapore Harness target.

No deployment, Secret access or database access. Kubeconfig credentials and raw
cloud/CLI output are never printed. This checks identity, not release readiness.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlsplit

TARGET = {
    "accountId": "5332868355276356",
    "profile": "acct6",
    "region": "ap-southeast-1",
    "clusterName": "fizzdragon-com-sg",
    "clusterId": "cb3e336c4059a4112b65c783e7bf67f1e",
    "namespace": "fizzdragon",
    "release": "fizzdragon",
}


class PreflightError(Exception):
    """Only locally authored messages are safe to report."""


def read_json(argv):
    try:
        result = subprocess.run(argv, capture_output=True, text=True,
                                timeout=45, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise PreflightError(f"{Path(argv[0]).name} unavailable or timed out") from None
    if result.returncode:
        raise PreflightError(f"{Path(argv[0]).name} read-only check failed; check login, permissions and connectivity")
    try:
        value = json.loads(result.stdout)
    except (ValueError, TypeError):
        raise PreflightError(f"{Path(argv[0]).name} returned invalid metadata") from None
    if not isinstance(value, dict):
        raise PreflightError(f"{Path(argv[0]).name} returned invalid metadata")
    return value


def endpoint(value):
    """Compare authenticated TLS endpoints without accepting URL credentials."""
    if not isinstance(value, str):
        raise PreflightError("Cannot verify the ACK API endpoint")
    try:
        url = urlsplit(value)
        if (url.scheme != "https" or not url.hostname or url.username is not None
                or url.password is not None or url.path not in ("", "/")
                or url.query or url.fragment or value != value.strip()):
            raise ValueError()
        return url.hostname.lower(), url.port or 443
    except ValueError:
        raise PreflightError("ACK API endpoints must use HTTPS without credentials or URL parameters") from None


def metadata_string(value, limit=256):
    return isinstance(value, str) and 0 < len(value) <= limit and value == value.strip()


def verify(kubeconfig):
    cloud = lambda *args: read_json([
        "aliyun", *args, "--profile", TARGET["profile"], "--region", TARGET["region"],
    ])
    identity = cloud("sts", "GetCallerIdentity")
    if str(identity.get("AccountId")) != TARGET["accountId"]:
        raise PreflightError("Profile acct6 must address account 5332868355276356; stopped before cluster access")

    cluster = cloud("cs", "GET", f"/clusters/{TARGET['clusterId']}")
    if (cluster.get("region_id") != TARGET["region"]
            or cluster.get("name") != TARGET["clusterName"]
            or cluster.get("cluster_id") != TARGET["clusterId"]
            or cluster.get("state") != "running"):
        raise PreflightError("ACK metadata must match the running fizzdragon-com-sg cluster in Singapore")
    endpoints = cluster.get("master_url")
    try:
        if isinstance(endpoints, str):
            endpoints = json.loads(endpoints)
        if not isinstance(endpoints, dict) or not endpoints:
            raise ValueError()
        valid_endpoints = {endpoint(value) for value in endpoints.values() if value}
        if not valid_endpoints:
            raise ValueError()
    except (ValueError, TypeError):
        raise PreflightError("ACK metadata does not contain verifiable API endpoints") from None

    kube = lambda *args: read_json([
        "kubectl", "--kubeconfig", kubeconfig, "--namespace", TARGET["namespace"], *args,
    ])
    config = kube("config", "view", "--minify", "-o", "json")
    try:
        clusters = config["clusters"]
        if len(clusters) != 1:
            raise ValueError()
        configured_cluster = clusters[0]["cluster"]
        if configured_cluster.get("insecure-skip-tls-verify"):
            raise PreflightError("Kubeconfig must verify the ACK API server TLS certificate")
        if configured_cluster.get("proxy-url"):
            raise PreflightError("Kubeconfig proxy-url requires separate endpoint review")
        if endpoint(configured_cluster["server"]) not in valid_endpoints:
            raise PreflightError("Kubeconfig endpoint does not match the verified Singapore ACK cluster")
    except (KeyError, IndexError, TypeError, ValueError):
        raise PreflightError("Cannot verify the selected kubeconfig cluster") from None

    namespace = kube("get", "namespace", TARGET["namespace"], "-o", "json")
    metadata = namespace.get("metadata", {})
    if (metadata.get("name") != TARGET["namespace"] or not metadata_string(metadata.get("uid"), 128)
            or metadata.get("deletionTimestamp")
            or namespace.get("status", {}).get("phase") != "Active"):
        raise PreflightError("The existing fizzdragon namespace must be active")
    classes = kube("get", "storageclass", "-o", "json")
    if not isinstance(classes.get("items"), list):
        raise PreflightError("StorageClass list metadata is invalid")
    storage_classes = []
    for item in classes["items"]:
        if (not isinstance(item, dict) or not isinstance(item.get("metadata"), dict)
                or not metadata_string(item["metadata"].get("name"))
                or not metadata_string(item.get("provisioner"))
                or item.get("reclaimPolicy") not in (None, "Retain", "Delete")
                or item.get("volumeBindingMode") not in (None, "Immediate", "WaitForFirstConsumer")):
            raise PreflightError("StorageClass entry metadata is invalid")
        storage_classes.append({
            "name": item["metadata"]["name"],
            "provisioner": item["provisioner"],
            "reclaimPolicy": item.get("reclaimPolicy"),
            "volumeBindingMode": item.get("volumeBindingMode"),
        })
    return {
        "target": TARGET,
        "namespaceUid": metadata["uid"],
        "storageClasses": storage_classes,
        "cloudIdentityVerified": True,
        "kubeconfigEndpointVerified": True,
        "secretsRead": False,
        "mutationsPerformed": False,
        "deploymentReady": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kubeconfig", required=True, help="Explicit kubeconfig for the Singapore cluster")
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.kubeconfig), indent=2))
    except (PreflightError, KeyError, IndexError, TypeError, AttributeError, ValueError):
        error = sys.exc_info()[1]
        print(f"FAILED: {error if isinstance(error, PreflightError) else 'Invalid target metadata; raw details withheld'}",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
