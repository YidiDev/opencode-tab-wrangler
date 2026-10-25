#!/usr/bin/env python3
"""Pack, install production dependencies outside the checkout, then exercise the real host."""

import argparse
import json
import os
import subprocess
import tarfile
import time
from pathlib import Path

from release import consumer_spec, verify_consumer

repo = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument(
    "--archive", type=Path, help="Verify this exact existing archive without repacking"
)
parser.add_argument(
    "--signatures",
    action="store_true",
    help="Verify registry signatures/provenance after publication",
)
parser.add_argument(
    "--acceptance",
    action="store_true",
    help="Exercise the full native matrix against these installed package bytes",
)
args = parser.parse_args()
if not args.archive:
    subprocess.run(["bun", "pm", "pack"], cwd=repo, check=True)
# Outside the repository: imports cannot accidentally fall back to its development node_modules.
root = Path.home() / ".cache" / "opencode-tab-wrangler-package-tests" / str(time.time_ns())
root.mkdir(parents=True)
(root / "package.json").write_text(
    json.dumps({"name": "wrangler-isolated-consumer", "version": "0.0.0", "private": True})
)
manifest = json.loads((repo / "package.json").read_text())
archive = (
    args.archive.resolve()
    if args.archive
    else repo / f"{manifest['name']}-{manifest['version']}.tgz"
)
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
        "THIRD_PARTY_NOTICES.md",
        "RELEASING.md",
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
    [
        "npm",
        "install",
        "--omit=dev",
        "--ignore-scripts",
        "--strict-peer-deps",
        "--no-audit",
        "--no-fund",
        consumer_spec(archive, manifest["name"], manifest["version"], args.signatures),
        "--registry=https://registry.npmjs.org/",
    ],
    cwd=root,
    env=env,
    check=True,
)
installed = root / "node_modules" / manifest["name"]
if not installed.is_dir():
    raise RuntimeError("Strict npm consumer install did not produce the package")
for name in expected:
    relative = name.removeprefix("package/")
    if (installed / relative).read_bytes() != (package / relative).read_bytes():
        raise RuntimeError("Consumer installation differs from the verified archive")
inventory = []
lock = json.loads((root / "package-lock.json").read_text())
verify_consumer(lock, archive, manifest["version"], args.signatures)
for path in sorted(lock["packages"]):
    if not path:
        continue
    file = root / path / "package.json"
    if not file.resolve().is_relative_to((root / "node_modules").resolve()):
        raise RuntimeError("Unexpected installed dependency path")
    data = json.loads(file.read_text())
    if data.get("license") not in {
        "MIT",
        "ISC",
        "BSD-2-Clause",
        "BSD-3-Clause",
        "Apache-2.0",
        "0BSD",
    }:
        raise RuntimeError("A tested runtime dependency requires explicit license review")
    inventory.append({"name": data["name"], "version": data["version"], "license": data["license"]})
evidence = repo / ".artifacts" / "release"
evidence.mkdir(parents=True, exist_ok=True)
(evidence / "runtime-dependencies.json").write_text(
    json.dumps(
        {
            "scope": "tested external runtime installation; not bundled libraries",
            "packages": inventory,
        },
        indent=2,
    )
    + "\n"
)
subprocess.run(
    ["npm", "audit", "--omit=dev", "--registry=https://registry.npmjs.org/"],
    cwd=root,
    env=env,
    check=True,
)
if args.signatures:
    subprocess.run(
        ["npm", "audit", "signatures", "--registry=https://registry.npmjs.org/"],
        cwd=root,
        env=env,
        check=True,
    )
subprocess.run(
    ["python3", str(repo / "tools/pty-smoke.py"), "--cleanup", "--package", str(installed)],
    cwd=repo,
    env=env,
    check=True,
)
print(f"PASS: packed plugin with production dependencies only: {installed}")
subprocess.run(
    ["python3", str(repo / "tools/pty-smoke.py"), "--compat", "--package", str(installed)],
    cwd=repo,
    env=env,
    check=True,
)
if args.acceptance:
    subprocess.run(
        ["python3", str(repo / "tools/acceptance.py"), "--package", str(installed)],
        cwd=repo,
        env=env,
        check=True,
    )
