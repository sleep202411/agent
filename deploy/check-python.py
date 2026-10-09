#!/usr/bin/env python3
"""Check the operator runtime before importing deployment modules or using cloud APIs."""
import sys


def check(version):
    if version[:2] < (3, 9):
        return (
            "Deployment requires Python 3.9 or newer; found {}.{}. "
            "Activate a newer Python environment so python3 resolves to it, then retry."
        ).format(version[0], version[1])
    return None


if __name__ == "__main__":
    error = check(sys.version_info)
    if error:
        print("FAILED: " + error, file=sys.stderr)
        sys.exit(1)
