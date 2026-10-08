#!/usr/bin/env python3
"""Read-only CN image verification through ACR's control plane (no Docker login)."""
import json
import re
import subprocess
import sys

INSTANCE = "cri-9fw21oj7s91k326l"


def query(action, **parameters):
    args = ["aliyun", "cr", action, "--region", "cn-hangzhou", "--profile", "default",
            "--InstanceId", INSTANCE]
    for key, value in parameters.items():
        args += ["--" + key, str(value)]
    try:
        result = subprocess.run(args, capture_output=True, text=True, check=True, timeout=45)
        payload = json.loads(result.stdout)
    except (subprocess.SubprocessError, ValueError):
        raise RuntimeError(f"CN ACR {action} could not be read; check CLI access/connectivity") from None
    if payload.get("IsSuccess") is not True or payload.get("Code") != "success":
        code = payload.get("Code", "unknown")
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", str(code)):
            code = "unknown"
        raise RuntimeError(f"CN ACR {action} failed ({code}); verify permissions and build the selected tag")
    return payload


def verify(tag, services):
    if not re.fullmatch(r"[0-9a-f]{40}", tag):
        raise ValueError("A full immutable Git SHA is required")
    if not services or any(s not in ("server", "studio", "web", "admin-ui", "agent-os", "agent") for s in services):
        raise ValueError("Invalid CN services")
    result = {}
    for service in services:
        name = f"fizzdragon-{service}"
        listing = query("ListRepository", RepoNamespaceName="fizzdragon", RepoName=name)
        rows = [r for r in listing.get("Repositories", [])
                if r.get("RepoName") == name and r.get("RepoNamespaceName") == "fizzdragon"
                and r.get("InstanceId") == INSTANCE and r.get("RepoStatus") == "NORMAL"]
        if len(rows) != 1 or listing.get("TotalCount") != 1:
            raise RuntimeError(f"CN repository {name} cannot be uniquely verified")
        payload = query("GetRepoTag", RepoId=rows[0]["RepoId"], Tag=tag)
        digest = payload.get("Digest", "")
        if not digest.startswith("sha256:"):
            digest = "sha256:" + digest
        if payload.get("Status") != "NORMAL" or payload.get("Tag") != tag or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
            raise RuntimeError(f"CN image {service}:{tag} is missing or has no valid manifest digest")
        result[service] = digest
    return result


if __name__ == "__main__":
    try:
        print(json.dumps(verify(sys.argv[1], sys.argv[2:])))
    except (ValueError, RuntimeError, OSError) as error:
        print(f"FATAL: {error}", file=sys.stderr)
        sys.exit(1)
