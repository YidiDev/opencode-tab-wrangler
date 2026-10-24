#!/usr/bin/env python3
"""Pack, install production dependencies outside the checkout, then exercise the real host."""

import json
import os
import subprocess
import tarfile
import time
from pathlib import Path

repo = Path(__file__).resolve().parents[1]
subprocess.run(["bun", "pm", "pack"], cwd=repo, check=True)
# Outside the repository: imports cannot accidentally fall back to its development node_modules.
root = Path.home() / ".cache" / "opencode-tab-wrangler-package-tests" / str(time.time_ns())
root.mkdir(parents=True)
manifest = json.loads((repo / "package.json").read_text())
archive = repo / f"{manifest['name']}-{manifest['version']}.tgz"
expected = {"package/package.json", "package/tui.ts", "package/schema.json"}
expected.update(
    f"package/{name}"
    for name in (
        "README.md",
        "DEVELOPMENT.md",
        "CONTRIBUTING.md",
        "SECURITY.md",
        "CODE_OF_CONDUCT.md",
        "CHANGELOG.md",
        "LICENSE",
    )
)
expected.update(
    f"package/{file.relative_to(repo)}"
    for file in (repo / "src").iterdir()
    if file.suffix in {".ts", ".tsx"}
)
with tarfile.open(archive) as packed:
    members = packed.getmembers()
    if (
        len(members) != len(expected)
        or any(not member.isfile() for member in members)
        or {member.name for member in members} != expected
    ):
        raise RuntimeError("Package contents differ from the reviewed runtime/doc allowlist")
subprocess.run(["tar", "-xzf", str(archive), "-C", str(root)], check=True)
package = root / "package"
env = dict(os.environ)
env.pop("NODE_PATH", None)
subprocess.run(
    ["bun", "install", "--production", "--ignore-scripts"], cwd=package, env=env, check=True
)
subprocess.run(
    ["python3", str(repo / "tools/pty-smoke.py"), "--cleanup", "--package", str(package)],
    cwd=repo,
    env=env,
    check=True,
)
print(f"PASS: packed plugin with production dependencies only: {package}")
