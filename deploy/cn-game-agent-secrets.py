#!/usr/bin/env python3
"""Provision missing CN Harness Secrets from the existing regional provider key.
Never prints credentials, writes them to disk, or rotates existing Secrets.
"""
import base64
import json
from pathlib import Path
import secrets
import subprocess

KUBE = ["kubectl", "--kubeconfig", str(Path.home() / ".kube/config-fizzdragon-cn"),
        "--context", "218059191361846222-c72d2039c68624a3e8d0dee257a13d451",
        "--namespace", "fizzdragon", "--request-timeout=30s"]


def invoke(args, payload=None):
    result = subprocess.run(KUBE + args, input=payload, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError("CN Secret operation failed; check connectivity and Kubernetes permissions")
    return result.stdout


def read(name):
    raw = invoke(["get", "secret", name, "--ignore-not-found", "-o", "json"])
    return json.loads(raw) if raw.strip() else None


def ensure(name, key, value_factory):
    existing = read(name)
    if existing:
        if not existing.get("data", {}).get(key):
            raise RuntimeError(f"Existing {name} lacks required key {key}; not modifying it")
        print(f"Verified existing {name}")
        return
    value = value_factory()
    if not value:
        raise RuntimeError("Source credential is empty")
    payload = {"apiVersion": "v1", "kind": "Secret", "type": "Opaque",
               "metadata": {"name": name, "namespace": "fizzdragon"},
               "data": {key: base64.b64encode(value).decode()}}
    # Atomic create; never overwrite a concurrently created Secret.
    invoke(["create", "-f", "-"], json.dumps(payload))
    print(f"Created {name}")


def provider_key():
    source = read("fizzdragon-server-secrets") or {}
    encoded = source.get("data", {}).get("BAILIAN_API_KEY")
    if not encoded:
        raise RuntimeError("CN server Secret has no BAILIAN_API_KEY")
    return base64.b64decode(encoded, validate=True)


def main():
    ensure("fizzdragon-game-agent-provider", "GAME_AGENT_OPENAI_API_KEY", provider_key)
    ensure("fizzdragon-game-agent-internal", "GAME_AGENT_INTERNAL_TOKEN",
           lambda: secrets.token_urlsafe(48).encode())


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        raise SystemExit(f"FATAL: {error}")
