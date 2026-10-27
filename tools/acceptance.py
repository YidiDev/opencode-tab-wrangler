#!/usr/bin/env python3
"""Bounded native acceptance matrix. No prompt submission or generation."""

import argparse
import hashlib
import json
import platform
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCENARIOS = [
    ("queued-global", ["--cleanup", "--scope", "global"]),
    ("queued-cwd", ["--cleanup", "--scope", "cwd"]),
    ("disabled", ["--lifecycle", "disabled"]),
    ("reload", ["--lifecycle", "reload"]),
    ("draft", ["--lifecycle", "draft"]),
    ("restart", ["--lifecycle", "restart"]),
    ("disconnect", ["--lifecycle", "disconnect"]),
    ("competing-global", ["--lifecycle", "competing", "--scope", "global"]),
    ("competing-cwd", ["--lifecycle", "competing", "--scope", "cwd"]),
]


def require_platform():
    if sys.platform != "linux" or platform.machine() not in ("x86_64", "amd64"):
        raise SystemExit("Native acceptance supports Linux x64 only")


def runtime_hash(directory=REPO):
    digest = hashlib.sha256()
    for path in [directory / "tui.ts", *sorted((directory / "src").glob("*.ts*"))]:
        content = path.read_bytes()
        digest.update(path.relative_to(directory).as_posix().encode() + b"\0")
        digest.update(len(content).to_bytes(8, "big") + content)
    return digest.hexdigest()


class NativeBudget:
    """Bootstrap is bounded separately; scenario progress never renews assertion time."""

    def __init__(self, now):
        self.started = False
        self.deadline = now + 180

    def observe(self, phase, now):
        if not self.started and phase not in {None, "starting"}:
            self.started = True
            self.deadline = now + 60


def main():
    require_platform()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, default=REPO)
    args = parser.parse_args()
    before = runtime_hash(args.package.resolve())
    passed = []
    for name, flags in SCENARIOS:
        subprocess.run(
            [
                sys.executable,
                str(REPO / "tools/pty-smoke.py"),
                *flags,
                "--package",
                str(args.package.resolve()),
            ],
            check=True,
            cwd=REPO,
        )
        passed.append(name)
    # Validate owner-run fixture setup, but NEVER submit its prompt in CI or as an agent.
    subprocess.run(
        [
            sys.executable,
            str(REPO / "tools/manual-running.py"),
            "--setup-only",
            "--package",
            str(args.package.resolve()),
        ],
        check=True,
        cwd=REPO,
    )
    evidence = REPO / ".artifacts/release/native-acceptance.json"
    if runtime_hash(args.package.resolve()) != before:
        raise RuntimeError("Runtime changed during native acceptance; no passing summary recorded")
    evidence.parent.mkdir(parents=True, exist_ok=True)
    evidence.write_text(
        json.dumps(
            {
                "host": "2.1.4",
                "platform": "linux-x64",
                "runtimeSha256": before,
                "passed": passed,
                "runningDescendant": "owner-run evidence required; setup-only is NOT a pass",
            },
            indent=2,
        )
        + "\n"
    )
    print("PASS: nine native acceptance scenarios; sanitized runtime-bound summary saved")


if __name__ == "__main__":
    main()
