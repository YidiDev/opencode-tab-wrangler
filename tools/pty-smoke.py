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
import socket
import struct
import subprocess
import termios
import time
import zlib
from pathlib import Path

repo = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument(
    "--scope", choices=("global", "cwd"), default="global", help="Native tab layout scope"
)
parser.add_argument(
    "--lifecycle",
    choices=("disabled", "reload", "draft", "restart", "disconnect", "competing"),
    help="Native disabled-tab or plugin hot-reload acceptance",
)
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
if args.compat or args.lifecycle:
    args.cleanup = True
binary = shutil.which("opencode")
if not binary:
    raise SystemExit("OpenCode 2.1.4 is required")
version = subprocess.check_output([binary, "--version"], text=True).strip()
if version not in ("opencode v2.1.4", "2.1.4", "v2.1.4"):
    raise SystemExit(f"Unsupported host: {version}")
root = repo / ".artifacts" / f"live-{time.time_ns()}"
root.mkdir(mode=0o700)
project = root / "project"
project.mkdir()
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
    if args.lifecycle == "draft":
        options["rules"] = [
            {
                "name": "fixture keeper",
                "match": {"title": "draft-selected"},
                "set": {"excluded": True},
            }
        ]
    if args.lifecycle in ("reload", "restart", "disconnect", "competing"):
        options["graceMinutes"] = 0.1  # Exceeds the first five-second cleanup tick.
    if args.lifecycle == "restart":
        options.update({"batchSize": 1, "order": "left-to-right"})
    if args.lifecycle == "disconnect":
        options["refreshTimeoutSeconds"] = 1
    if args.lifecycle == "competing":
        options.update(
            {
                "acknowledgeSharedTabs": False,
                "batchSize": 1,
                "rules": [
                    {
                        "name": "both fixture keepers",
                        "match": {"title": "competing-selected-*"},
                        "set": {"excluded": True},
                    }
                ],
            }
        )
    probe = root / "probe"
    probe.mkdir()
    (probe / "tui.ts").write_text(
        (
            repo
            / "tools"
            / (
                "competing-probe.ts"
                if args.lifecycle == "competing"
                else "draft-probe.ts"
                if args.lifecycle == "draft"
                else "transport-probe.ts"
                if args.lifecycle in ("restart", "disconnect")
                else "lifecycle-probe.ts"
                if args.lifecycle
                else "compat-probe.ts"
                if args.compat
                else "live-probe.ts"
            )
        ).read_text()
    )
    plugins.append(
        {
            "package": str(probe),
            "options": {"scenario": args.lifecycle, "role": "a", "scope": args.scope},
        }
    )
(config / "cli.json").write_text(
    json.dumps(
        {
            "$schema": "https://opencode.ai/v2/cli.json",
            "highlights": False,
            "tabs": {"scope": args.scope, "enabled": args.lifecycle != "disabled"},
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


def stop_native(child):
    for action in (signal.SIGCONT, signal.SIGTERM):
        try:
            os.killpg(child.pid, action)
        except ProcessLookupError:
            pass
    if child.poll() is None:
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    child.wait()


backend = None
server_flags = ["--standalone"]
if args.lifecycle in ("disconnect", "competing"):
    env["OPENCODE_PASSWORD"] = os.urandom(24).hex()  # Private, disposable loopback server only.
    with socket.socket() as bound:
        bound.bind(("127.0.0.1", 0))
        port = bound.getsockname()[1]
    with (root / "backend.log").open("wb") as log:
        backend = subprocess.Popen(
            [binary, "serve", "--hostname", "127.0.0.1", "--port", str(port)],
            env=env,
            cwd=project,
            stdout=log,
            stderr=log,
            start_new_session=True,
        )
    deadline = time.monotonic() + 15
    while True:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                break
        except OSError:
            if backend.poll() is not None or time.monotonic() >= deadline:
                stop_native(backend)
                raise RuntimeError("Private fixture backend failed to start") from None
            time.sleep(0.05)
    server_flags = ["--server", f"http://127.0.0.1:{port}"]


def launch(peer=False):
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 48, 140, 0, 0))
    child_env = dict(env)
    if peer:
        child_env["XDG_CONFIG_HOME"] = str(root / "config-peer")
    child = subprocess.Popen(
        [
            binary,
            *server_flags,
            "--log-level",
            "debug",
            str(project / "child" if peer and args.scope == "cwd" else project),
        ],
        stdin=slave,
        stdout=slave,
        stderr=slave,
        env=child_env,
        cwd=project,
        start_new_session=True,
    )
    os.close(slave)
    return child, master


process, master = launch()
peer_process, peer_master, peer_capture = None, None, bytearray()
capture = bytearray()
sent = False
submitted = False
rendered = False
passed = False
reconfigured = False
draft_stage = 0
draft_step_at = 0.0
draft_capture = 0
draft_marker = "WRANGLER_DRAFT_9D2"
transport_stage = 0
transport_key_at = 0.0
attachment = project / "fixture.png"
if args.lifecycle == "draft":

    def png_chunk(kind, data):
        return (
            struct.pack("!I", len(data)) + kind + data + struct.pack("!I", zlib.crc32(kind + data))
        )

    attachment.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", struct.pack("!2I5B", 1, 1, 8, 6, 0, 0, 0))
        + png_chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00\xff"))
        + png_chunk(b"IEND", b"")
    )
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
            if args.lifecycle == "competing":
                if report.get("phase") == "ready" and peer_process is None:
                    peer_config = root / "config-peer/opencode"
                    peer_config.mkdir(parents=True)
                    peer_options = json.loads((config / "cli.json").read_text())
                    peer_options["plugins"][-1]["options"]["role"] = "b"
                    (peer_config / "cli.json").write_text(json.dumps(peer_options))
                    (peer_config / "opencode.json").write_text(
                        (config / "opencode.json").read_text()
                    )
                    peer_process, peer_master = launch(peer=True)
                elif report.get("phase") == "unacknowledged-protected" and not reconfigured:
                    state = json.loads(
                        (
                            root
                            / "state/opencode/latest/tui/plugin.opencode.tab-wrangler.state.json"
                        ).read_text()
                    )
                    if state["corral"]:
                        raise RuntimeError("Unacknowledged competing clients admitted an intent")
                    for folder in (config, root / "config-peer/opencode"):
                        next_config = json.loads((folder / "cli.json").read_text())
                        next_config["plugins"][0]["options"]["acknowledgeSharedTabs"] = True
                        next_config["plugins"][-1]["options"]["epoch"] = 1
                        pending = folder / "cli.next"
                        pending.write_text(json.dumps(next_config))
                        pending.replace(folder / "cli.json")
                    reconfigured = True
            if (
                args.lifecycle == "restart"
                and report.get("phase") == "restart"
                and transport_stage == 0
            ):
                state = json.loads(
                    (
                        root / "state/opencode/latest/tui/plugin.opencode.tab-wrangler.state.json"
                    ).read_text()
                )
                if any(
                    e["sessionID"] == report["ids"][1] and e["state"] == "closed"
                    for e in state["corral"]
                ):
                    stop_native(process)
                    os.close(master)
                    process, master = launch()
                    transport_stage = 1
            if args.lifecycle == "disconnect":
                if report.get("phase") == "ready" and time.monotonic() >= transport_key_at:
                    # Obtain a native keymap acknowledgement before pausing the backend;
                    # fixture setup can precede the terminal's final startup barrier.
                    os.write(master, b"\x1b[19~")
                    transport_key_at = time.monotonic() + 1
                if report.get("phase") == "armed" and transport_stage == 0:
                    os.killpg(backend.pid, signal.SIGSTOP)
                    os.write(master, b"\x1b[20~")
                    transport_stage = 1
                elif report.get("phase") == "offline-protected" and transport_stage == 1:
                    state = json.loads(
                        (
                            root
                            / "state/opencode/latest/tui/plugin.opencode.tab-wrangler.state.json"
                        ).read_text()
                    )
                    if state["corral"]:
                        raise RuntimeError("Disconnected backend admitted a close intent")
                    os.killpg(backend.pid, signal.SIGCONT)
                    os.write(master, b"\x1b[19~")
                    transport_stage = 2
            if args.lifecycle == "draft":
                now = time.monotonic()
                if report.get("phase") == "ready" and draft_stage == 0:
                    draft_stage, draft_step_at = 1, now + 0.5
                if now >= draft_step_at:
                    if draft_stage == 1:
                        os.write(master, b"\x1b[200~" + attachment.as_uri().encode() + b"\x1b[201~")
                        draft_stage, draft_step_at = 2, now + 0.5
                    elif draft_stage == 2:
                        os.write(master, b"\x1b[200~" + draft_marker.encode() + b"\x1b[201~")
                        draft_stage, draft_step_at = 3, now + 0.5
                    elif draft_stage == 3:
                        os.write(master, b"\x1b[19~")
                        draft_stage = 4
                if report.get("phase") == "closed" and draft_stage == 4:
                    state_file = (
                        root / "state/opencode/latest/tui/plugin.opencode.tab-wrangler.state.json"
                    )
                    state = json.loads(state_file.read_text())
                    if any(
                        e["sessionID"] == report["ids"][1] and e["state"] == "closed"
                        for e in state["corral"]
                    ):
                        draft_capture = len(capture)
                        os.write(master, b"\x1b[19~")
                        draft_stage = 5
                if report.get("phase") == "restored" and draft_stage == 5:
                    restored = re.sub(
                        r"\x1b\[[0-?]*[ -/]*[@-~]",
                        "",
                        capture[draft_capture:].decode("utf-8", errors="replace"),
                    )
                    if draft_marker in restored:
                        os.write(master, b"\x1b[19~")
                        draft_stage = 6
                if report.get("phase") == "passed" and draft_stage != 6:
                    raise RuntimeError(
                        "Native draft text was not independently observed after restoration"
                    )
            if (
                args.lifecycle == "reload"
                and report.get("phase") == "reloading"
                and not reconfigured
            ):
                # Change ONLY this isolated fixture's CLI config. Reloading unchanged sources
                # may reuse their instances; changed options must replace both plugin owners.
                next_config = json.loads((config / "cli.json").read_text())
                next_config["plugins"][0]["options"]["notification"] = "silent"
                next_config["plugins"][-1]["options"]["epoch"] = 1
                pending_config = config / "cli.next"
                pending_config.write_text(json.dumps(next_config))
                pending_config.replace(config / "cli.json")
                reconfigured = True
            if report.get("phase") == "failed":
                if args.compat:
                    print(
                        json.dumps(
                            {
                                "scenario": "native-unread",
                                "activity": report.get("nativeActivity"),
                                "error": report.get("nativeError"),
                            }
                        )
                    )
                raise RuntimeError("Live cleanup probe failed")
        if process.poll() is not None:
            break
        if peer_process is not None:
            if peer_process.poll() is not None:
                raise RuntimeError("Peer CLI exited early")
            if select.select([peer_master], [], [], 0)[0]:
                data = os.read(peer_master, 65536)
                peer_capture.extend(data)
                for query, answer in [
                    (b"\x1b[6n", b"\x1b[1;1R"),
                    (b"\x1b[c", b"\x1b[?1;2c"),
                    (b"\x1b[>c", b"\x1b[>0;0;0c"),
                    (b"\x1b]11;?", b"\x1b]11;rgb:1010/1010/1010\x1b\\"),
                    (b"\x1b]10;?", b"\x1b]10;rgb:eeee/eeee/eeee\x1b\\"),
                ]:
                    if query in data:
                        os.write(peer_master, answer)
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
            if args.lifecycle == "disabled":
                state = (
                    root
                    / "state"
                    / "opencode"
                    / "latest"
                    / "tui"
                    / "plugin.opencode.tab-wrangler.state.json"
                )
                if json.loads(state.read_text()).get("corral") != []:
                    raise RuntimeError("Disabled tabs admitted a recovery intent")
            if args.lifecycle == "restart":
                state = json.loads(
                    (
                        root / "state/opencode/latest/tui/plugin.opencode.tab-wrangler.state.json"
                    ).read_text()
                )
                if report.get("setupCount") != 2 or not any(
                    e["sessionID"] == report["ids"][1] and e["state"] == "closed"
                    for e in state["corral"]
                ):
                    raise RuntimeError("Recovery history did not survive private process restart")
            if args.lifecycle == "competing":
                state = json.loads(
                    (
                        root / "state/opencode/latest/tui/plugin.opencode.tab-wrangler.state.json"
                    ).read_text()
                )
                if any(
                    e["sessionID"] not in report["ids"][2:] or e["state"] == "intent"
                    for e in state["corral"]
                ):
                    raise RuntimeError(
                        "Competing controllers left an unresolved intent or touched a keeper"
                    )
            detail = (
                f"native lifecycle {args.lifecycle}"
                if args.lifecycle
                else "native unread activity/error protection with imported empty fixtures"
                if args.compat
                else "automatic closure, selected/question/permission/queued-descendant protection, parked context, intact sessions, and restoration"
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
    stop_native(process)
    if peer_process is not None:
        stop_native(peer_process)
        os.close(peer_master)
        (root / "peer-terminal.log").write_bytes(peer_capture)
    if backend is not None:
        stop_native(backend)
    os.close(master)
    print(f"Isolated evidence: {root}")
