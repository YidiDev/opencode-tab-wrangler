#!/usr/bin/env python3
"""Isolated native running evidence; explicit authorized-agent mode uses only the dummy provider."""

import argparse
import contextlib
import fcntl
import json
import os
import pty
import select
import shutil
import signal
import struct
import subprocess
import sys
import termios
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from acceptance import require_platform, runtime_hash

REPO = Path(__file__).resolve().parents[1]


def main():
    require_platform()
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--setup-only", action="store_true")
    mode.add_argument(
        "--authorized-agent",
        action="store_true",
        help="Explicit owner-authorized local dummy execution; never for CI",
    )
    parser.add_argument("--package", type=Path, default=REPO)
    args = parser.parse_args()
    if args.authorized_agent and os.environ.get("CI"):
        raise SystemExit("CI must use --setup-only; authorized-agent execution is local only")
    if not args.setup_only and not args.authorized_agent and not sys.stdin.isatty():
        raise SystemExit(
            "A human must run this in their terminal and press Enter. Agents/CI use --setup-only."
        )
    before = runtime_hash(args.package.resolve())
    binary = shutil.which("opencode")
    if not binary or subprocess.check_output([binary, "--version"], text=True).strip() not in (
        "opencode v2.1.4",
        "2.1.4",
        "v2.1.4",
    ):
        raise SystemExit("OpenCode 2.1.4 is required")
    root = REPO / ".artifacts" / f"manual-running-{time.time_ns()}"
    root.mkdir(mode=0o700)
    project = root / "project"
    (project / "child").mkdir(parents=True)
    config = root / "config" / "opencode"
    config.mkdir(parents=True)
    fixture = root / "probe"
    fixture.mkdir()
    shutil.copy(REPO / "tools/running-probe.ts", fixture / "tui.ts")
    admitted, ending = threading.Event(), threading.Event()
    counts = {"requests": 0, "blocked": 0}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Never log request bodies, prompts, credentials, or raw URLs.

        def do_POST(self):
            counts["requests"] += 1
            if not admitted.is_set():
                counts["blocked"] += 1
                self.send_error(403)
                return
            if self.path != "/v1/chat/completions":
                self.send_error(404)
                return
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 2_000_000:
                self.send_error(413)
                return
            body = json.loads(self.rfile.read(size))
            if body.get("model") != "holding":
                self.send_error(400)
                return
            try:
                self.send_response(200)
                self.send_header(
                    "Content-Type",
                    "text/event-stream" if body.get("stream") else "application/json",
                )
                self.end_headers()
                if body.get("stream"):

                    def chunk(delta, finish=None):
                        packet = {
                            "id": "fixture",
                            "object": "chat.completion.chunk",
                            "created": 1,
                            "model": "holding",
                            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
                        }
                        self.wfile.write(("data: " + json.dumps(packet) + "\n\n").encode())
                        self.wfile.flush()

                    chunk({"role": "assistant"})
                    if ending.wait(25):
                        return
                    chunk({"content": "Fixture complete. No tools were called."})
                    chunk({}, "stop")
                    self.wfile.write(b"data: [DONE]\n\n")
                    self.wfile.flush()
                else:
                    if ending.wait(25):
                        return
                    self.wfile.write(
                        json.dumps(
                            {
                                "id": "fixture",
                                "object": "chat.completion",
                                "created": 1,
                                "model": "holding",
                                "choices": [
                                    {
                                        "index": 0,
                                        "message": {
                                            "role": "assistant",
                                            "content": '{"title":"Fixture"}',
                                        },
                                        "finish_reason": "stop",
                                    }
                                ],
                                "usage": {
                                    "prompt_tokens": 1,
                                    "completion_tokens": 1,
                                    "total_tokens": 2,
                                },
                            }
                        ).encode()
                    )
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    provider = {
        "name": "Local holding fixture (no paid model)",
        "package": "@opencode/ai/providers/openai-compatible",
        "settings": {
            "baseURL": f"http://127.0.0.1:{server.server_port}/v1",
            "apiKey": "fixture-only",
            "encoding": "none",
        },
        "models": {
            "holding": {
                "name": "Local holding fixture",
                "limit": {"context": 100000, "output": 2000},
            }
        },
    }
    (config / "opencode.json").write_text(
        json.dumps(
            {
                "$schema": "https://opencode.ai/config.json",
                "model": "fixture/holding",
                "agents": {
                    name: {"model": "fixture/holding"} for name in ["build", "title", "compaction"]
                },
                "providers": {"fixture": provider},
            }
        )
    )
    options = {
        "mode": "preview",
        "connectionKey": "isolated-running",
        "acknowledgeSharedTabs": True,
        "idleMinutes": 0,
        "graceMinutes": 0.1,
        "checkSeconds": 5,
        "minTabs": 1,
        "cleanup": "all-idle",
        "batchSize": 3,
        "batchDelaySeconds": 0,
        "protections": {
            name: False
            for name in [
                "unreadActivity",
                "unreadErrors",
                "questions",
                "permissions",
                "pending",
                "attention",
            ]
        },
        "activity": {name: False for name in ["selection", "sessionUpdates", "backgroundEvents"]},
        "rules": [
            {
                "name": "fixture keeper",
                "match": {"title": "running-keeper"},
                "set": {"excluded": True},
            }
        ],
    }
    cli = {
        "$schema": "https://opencode.ai/cli.json",
        "tabs": {"enabled": True, "scope": "global"},
        "plugins": [
            {"package": str(args.package.resolve()), "options": options},
            {"package": str(fixture), "options": {"submit": False}},
        ],
    }
    cli_path = config / "cli.json"
    cli_path.write_text(json.dumps(cli))
    env = {
        "PATH": os.environ["PATH"],
        "TERM": "xterm-256color",
        "LANG": "C.UTF-8",
        "HOME": str(root / "home"),
        "OPENCODE_TEST_HOME": str(root / "home"),
        "XDG_CONFIG_HOME": str(root / "config"),
        "XDG_DATA_HOME": str(root / "data"),
        "XDG_STATE_HOME": str(root / "state"),
        "XDG_CACHE_HOME": str(root / "cache"),
    }
    for name in ["HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]:
        Path(env[name]).mkdir(parents=True, exist_ok=True)
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 48, 140, 0, 0))
    process = subprocess.Popen(
        [binary, "--standalone", str(project)],
        stdin=slave,
        stdout=slave,
        stderr=slave,
        env=env,
        start_new_session=True,
    )
    os.close(slave)
    report_path = root / "state/opencode/latest/tui/plugin.test.tab-wrangler-probe.results.json"
    prompted, enabled, restoring = False, False, False
    armed_at = 0
    deadline = time.monotonic() + 180
    try:
        with (root / "terminal.log").open("wb") as log:
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError("Private native CLI exited")
                if select.select([master], [], [], 0.1)[0]:
                    data = os.read(master, 65536)
                    log.write(data)
                    for query, response in [
                        (b"\x1b[6n", b"\x1b[1;1R"),
                        (b"\x1b[c", b"\x1b[?1;2c"),
                        (b"\x1b[>c", b"\x1b[>0;0;0c"),
                        (b"\x1b]11;?", b"\x1b]11;rgb:1010/1010/1010\x1b\\"),
                    ]:
                        if query in data:
                            os.write(master, response)
                if not report_path.exists():
                    continue
                report = json.loads(report_path.read_text())
                if report["phase"] == "ready" and time.monotonic() - armed_at > 1:
                    os.write(master, b"\x1b[19~")
                    armed_at = time.monotonic()
                if report["phase"] == "armed" and not prompted:
                    if args.setup_only:
                        if counts["requests"]:
                            raise RuntimeError("Unexpected inference attempt during setup")
                        print(
                            "PASS: isolated model/child/PTY setup only; ZERO inference requests. Running gate is NOT passed."
                        )
                        return
                    if args.authorized_agent:
                        print(
                            "Authorized-agent execution: ONE isolated loopback-only fixture prompt; no external model or real user session.",
                            flush=True,
                        )
                        time.sleep(1)
                    else:
                        print(
                            "Private fixture ready. Press Enter HERE to submit ONE local-only fixture prompt. No paid provider or user session is used; wait for PASS.",
                            flush=True,
                        )
                        input()
                    deadline = time.monotonic() + 120
                    admitted.set()
                    cli["plugins"][1]["options"] = {
                        "submit": True,
                        "initiator": "owner-authorized-agent" if args.authorized_agent else "owner",
                    }
                    replacement = cli_path.with_suffix(".next")
                    replacement.write_text(json.dumps(cli))
                    replacement.replace(cli_path)
                    prompted = True
                if report["phase"] == "working" and not enabled:
                    options["mode"] = "auto"
                    replacement = cli_path.with_suffix(".next")
                    replacement.write_text(json.dumps(cli))
                    replacement.replace(cli_path)
                    enabled = True
                if report["phase"] == "closed" and not restoring:
                    state_path = (
                        root / "state/opencode/latest/tui/plugin.opencode.tab-wrangler.state.json"
                    )
                    if state_path.exists() and any(
                        entry["sessionID"] == report["ids"][1] and entry["state"] == "closed"
                        for entry in json.loads(state_path.read_text())["corral"]
                    ):
                        os.write(master, b"\x1b[19~")
                        restoring = True
                if report["phase"] == "failed":
                    raise RuntimeError(
                        "Native running-descendant assertions failed; inspect private fixture evidence"
                    )
                if report["phase"] == "passed":
                    if (
                        not prompted
                        or not enabled
                        or not report["protectedDuringCleanup"]
                        or not counts["requests"]
                        or counts["blocked"]
                    ):
                        raise RuntimeError("Incomplete owner-run evidence")
                    if runtime_hash(args.package.resolve()) != before:
                        raise RuntimeError("Runtime changed during owner-run verification")
                    evidence = {
                        "scenario": "running-descendants",
                        "status": "passed",
                        "host": "2.1.4",
                        "platform": "linux-x64",
                        "runtimeSha256": before,
                        "provider": "loopback-only deterministic fixture",
                        "ownerSubmitted": not args.authorized_agent,
                        "ownerAuthorizedAgent": args.authorized_agent,
                        "protectedDuringEligibleIdleCleanup": True,
                        "completedParentClosedAndRestored": True,
                        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    }
                    (root / "evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
                    print(
                        f"PASS: real native running descendant protected while eligible idles closed; completed parent recovered. Evidence: {root / 'evidence.json'}"
                    )
                    return
        raise RuntimeError("Fixture timed out; no passing running evidence recorded")
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        os.close(master)
        ending.set()
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
