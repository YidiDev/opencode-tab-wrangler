#!/usr/bin/env python3
"""Explicit, isolated OpenCode loading/dialog smoke test. No user sessions or credentials."""

import argparse
import fcntl
import json
import os
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import termios
import time
from pathlib import Path

repo = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument(
    "--compat",
    action="store_true",
    help="Verify real native unread/error mapping with imported empty fixture sessions",
)
parser.add_argument(
    "--spec",
    help="Exact npm package spec; exercises native registry acquisition, not a local directory",
)
parser.add_argument(
    "--cleanup",
    action="store_true",
    help="Also verify real automatic closure, waiting/selected protection, and recovery",
)
parser.add_argument(
    "--package",
    type=Path,
    default=repo,
    help="Plugin directory (use an extracted archive for package testing)",
)
args = parser.parse_args()
if args.compat:
    args.cleanup = True
binary = shutil.which("opencode")
if not binary:
    raise SystemExit("OpenCode 2.1.4 is required")
version = subprocess.check_output([binary, "--version"], text=True).strip()
if version not in ("opencode v2.1.4", "2.1.4", "v2.1.4"):
    raise SystemExit(f"Unsupported host: {version}")
root = repo / ".artifacts" / f"live-{time.time_ns()}"
project = root / "project"
project.mkdir(parents=True)
(project / "child").mkdir()
config = root / "config" / "opencode"
config.mkdir(parents=True)
options = {"mode": "preview"}
plugins = [{"package": args.spec or str(args.package.resolve()), "options": options}]
if args.cleanup:
    options.update(
        {
            "mode": "auto",
            "connectionKey": "isolated-live",
            "acknowledgeSharedTabs": True,
            "idleMinutes": 0.02,
            "graceMinutes": 0.02,
            "checkSeconds": 5,
            "minTabs": 1,
            "cleanup": "all-idle",
            "batchSize": 3,
            "batchDelaySeconds": 0,
        }
    )
    probe = root / "probe"
    probe.mkdir()
    (probe / "tui.ts").write_text(
        (repo / "tools" / ("compat-probe.ts" if args.compat else "live-probe.ts")).read_text()
    )
    plugins.append({"package": str(probe)})
(config / "cli.json").write_text(
    json.dumps(
        {
            "$schema": "https://opencode.ai/v2/cli.json",
            "highlights": False,
            "plugins": plugins,
        }
    )
)
(config / "opencode.json").write_text(json.dumps({"$schema": "https://opencode.ai/config.json"}))
# Deliberately do not inherit provider keys, service URLs, or OpenCode overrides.
env = {key: os.environ[key] for key in ("PATH", "LANG", "LC_ALL", "SHELL") if key in os.environ}
env.update(
    {
        "HOME": str(root / "home"),
        "XDG_CONFIG_HOME": str(root / "config"),
        "OPENCODE_TEST_HOME": str(root / "home"),
        "XDG_DATA_HOME": str(root / "data"),
        "XDG_STATE_HOME": str(root / "state"),
        "XDG_CACHE_HOME": str(root / "cache"),
        "TERM": "xterm-256color",
        "COLORTERM": "truecolor",
    }
)
Path(env["HOME"]).mkdir()
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 48, 140, 0, 0))
process = subprocess.Popen(
    [binary, "--standalone", "--log-level", "debug", str(project)],
    stdin=slave,
    stdout=slave,
    stderr=slave,
    env=env,
    cwd=project,
    start_new_session=True,
)
os.close(slave)
capture = bytearray()
sent = False
submitted = False
rendered = False
passed = False
text = ""
start = time.monotonic()
try:
    while time.monotonic() - start < 60:
        report = {}
        results = (
            root
            / "state"
            / "opencode"
            / "latest"
            / "tui"
            / "plugin.test.tab-wrangler-probe.results.json"
        )
        if args.cleanup and results.exists():
            report = json.loads(results.read_text())
            if report.get("phase") == "failed":
                raise RuntimeError("Live cleanup probe failed")
        if process.poll() is not None:
            break
        if select.select([master], [], [], 0.1)[0]:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            capture.extend(data)
            if b"\x1b[6n" in data:
                os.write(master, b"\x1b[1;1R")
            if b"\x1b[c" in data:
                os.write(master, b"\x1b[?1;2c")
            if b"\x1b[>c" in data:
                os.write(master, b"\x1b[>0;0;0c")
            if b"\x1b]11;?" in data:
                os.write(master, b"\x1b]11;rgb:1010/1010/1010\x1b\\")
            if b"\x1b]10;?" in data:
                os.write(master, b"\x1b]10;rgb:eeee/eeee/eeee\x1b\\")
        if (
            not sent
            and time.monotonic() - start > 12
            and (not args.cleanup or report.get("phase") == "passed")
        ):
            os.write(master, b"/wrangler\r")
            sent = True
        text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", capture.decode("utf-8", errors="replace"))
        if "protection inspector" in text and "Corral / recently" in text:
            rendered = True
            if not args.cleanup:
                print(f"PASS: {version}; Wrangler manager rendered in isolated PTY")
                passed = True
                break
        if sent and not submitted and time.monotonic() - start > 14 and "Tab Wrangler" in text:
            # First Enter accepts slash completion; second invokes the recognized command.
            os.write(master, b"\r")
            submitted = True
        if args.cleanup and rendered and report.get("phase") == "passed":
            detail = (
                "native unread activity/error protection with imported empty fixtures"
                if args.compat
                else "automatic closure, selected/question/permission protection, parked context, intact sessions, and restoration"
            )
            print(f"PASS: {version}; manager, {detail}")
            passed = True
            break
    else:
        raise RuntimeError("Timed out before live assertions completed")
    if not passed:
        raise RuntimeError("OpenCode exited before live assertions completed")
finally:
    (root / "terminal.log").write_bytes(capture)
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    if process.poll() is None:
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    os.close(master)
    print(f"Isolated evidence: {root}")
