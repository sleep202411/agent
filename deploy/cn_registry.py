#!/usr/bin/env python3
"""Read-only CN image verification through ACR's control plane (no Docker login)."""
import json
import re
import subprocess
import sys
import time

INSTANCE = "cri-9fw21oj7s91k326l"


def query(action, **parameters):
    args = ["aliyun", "cr", action, "--region", "cn-hangzhou", "--profile", "default",
            "--InstanceId", INSTANCE]
    for key, value in parameters.items():
        args += ["--" + key, str(value)]
    for attempt in range(4):
        retryable = True
        try:
            result = subprocess.run(args, capture_output=True, text=True, check=True, timeout=45)
            payload = json.loads(result.stdout)
            if not isinstance(payload, dict):
                reason = "invalid JSON response shape"
            elif payload.get("IsSuccess") is True and payload.get("Code") == "success":
                return payload
            else:
                code = safe_code(payload.get("Code", "unknown"))
                reason = f"API error {code}"
                retryable = transient_code(code)
        except subprocess.TimeoutExpired:
            reason = "CLI request timed out after 45 seconds"
        except subprocess.CalledProcessError as error:
            # Never print raw CLI output: it may contain signed requests.
            detail = (error.stderr or "") + "\n" + (error.stdout or "")
            match = re.search(r"(?:ErrorCode|Code)[\"']?\s*[:=]\s*[\"']?([A-Za-z0-9_.-]+)", detail)
            code = safe_code(match[1]) if match else None
            if code:
                reason = f"CLI API error {code}"
                retryable = transient_code(code)
            elif re.search(r"forbidden|accessdenied|invalidaccesskey|signaturedoesnotmatch|unauthorized|credential", detail, re.I):
                reason = "CLI authentication or permission failure"
                retryable = False
            else:
                reason = f"CLI exited {error.returncode} (transport or CLI failure)"
        except ValueError:
            reason = "CLI returned invalid JSON"
        if not retryable or attempt == 3:
            raise RuntimeError(
                f"CN ACR {action} failed after {attempt + 1} attempt(s): {reason}. "
                "Release remains saved; correct access/connectivity and resume."
            ) from None
        delay = (2, 5, 10)[attempt]
        print(f"==> CN ACR {action}: {reason}; retry {attempt + 2}/4 in {delay}s",
              file=sys.stderr, flush=True)
        time.sleep(delay)


def safe_code(value):
    return str(value) if re.fullmatch(r"[A-Za-z0-9_.-]+", str(value)) else "unknown"


def transient_code(code):
    return code.lower().startswith((
        "throttl", "serviceunavailable", "internalerror", "internalfailure",
        "requesttimeout", "sdk.timeout", "sdk.serverunreachable",
        "sdk.readtimeout", "sdk.connecttimeout", "sdk.networkerror",
    ))


def verify(tag, services):
    if not re.fullmatch(r"[0-9a-f]{40}", tag):
        raise ValueError("A full immutable Git SHA is required")
    if not services or any(s not in ("server", "studio", "web", "admin-ui", "agent-os", "game-agent", "app-story-agent", "agent") for s in services):
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
