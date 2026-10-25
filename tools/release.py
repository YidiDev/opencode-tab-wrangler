#!/usr/bin/env python3
"""Fail-closed release operations. No dependency imports and no automatic mutation retries."""

import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import tarfile
import time
import urllib.error
import urllib.request
from pathlib import Path

NAME = "opencode-tab-wrangler"
REPOSITORY = "YidiDev/opencode-tab-wrangler"
REGISTRY = "https://registry.npmjs.org"
VERSION = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$")
DOCS = {
    "README.md",
    "DEVELOPMENT.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "CODE_OF_CONDUCT.md",
    "CHANGELOG.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "RELEASING.md",
}
REQUIREMENTS = {
    "native-unread-activity-error",
    "executable-queued-work",
    "running-descendants",
    "drafts-and-attachments",
    "disconnect-restart-reload",
    "tab-scopes-and-disabled-tabs",
    "competing-clients-acknowledged-limitations",
}


def check_running_evidence(root):
    record = json.loads((root / "test/evidence/running-descendants.json").read_text())
    digest = hashlib.sha256()
    for path in [root / "tui.ts", *sorted((root / "src").glob("*.ts*"))]:
        content = path.read_bytes()
        digest.update(path.relative_to(root).as_posix().encode() + b"\0")
        digest.update(len(content).to_bytes(8, "big") + content)
    if (
        record.get("scenario") != "running-descendants"
        or record.get("status") != "passed"
        or record.get("host") != "2.1.4"
        or record.get("platform") != "linux-x64"
        or record.get("ownerSubmitted") is not True
        or record.get("protectedDuringEligibleIdleCleanup") is not True
        or record.get("completedParentClosedAndRestored") is not True
        or record.get("runtimeSha256") != digest.hexdigest()
    ):
        raise ValueError("Owner-run running evidence does not match this runtime")


def check_stable_readiness(version, policy):
    if VERSION.fullmatch(version) and "-rc." in version:
        return
    requirements = policy.get("stableRequirements", {})
    if (
        policy.get("host") != "2.1.4"
        or policy.get("platform") != "linux-x64"
        or set(requirements) != REQUIREMENTS
    ):
        raise ValueError(
            "Stable compatibility evidence must cover the reviewed host/platform and exact matrix"
        )
    if any(
        item.get("status") != "passed" or not item.get("evidence", "").strip()
        for item in requirements.values()
    ):
        raise ValueError("Stable release is blocked by incomplete live compatibility evidence")


def run(*args, capture=False):
    result = subprocess.run(args, check=True, text=True, capture_output=capture)
    return result.stdout.strip() if capture else None


def version_info(tag, version):
    match = VERSION.fullmatch(version)
    if not match or tag != f"v{version}":
        raise ValueError("Tag must exactly match a stable or rc.N package version")
    return "next" if match[4] else "candidate"


def consumer_spec(archive, name, version, signatures=False):
    if name != NAME or not VERSION.fullmatch(version):
        raise ValueError("Unexpected consumer package identity")
    # A file: install is skipped by npm's registry signature verifier. Use the exact
    # registry spec after publication so our own package's provenance is verified too.
    return f"{name}@{version}" if signatures else str(archive)


def verify_consumer(lock, archive, version, signatures=False):
    entry = lock.get("packages", {}).get(f"node_modules/{NAME}", {})
    integrity = (
        "sha512-" + base64.b64encode(hashlib.sha512(Path(archive).read_bytes()).digest()).decode()
    )
    if entry.get("version") != version or entry.get("integrity") != integrity:
        raise ValueError("Installed consumer differs from the verified archive")
    if signatures and not entry.get("resolved", "").startswith(f"{REGISTRY}/{NAME}/-/"):
        raise ValueError("Signature verification requires our registry-resolved package")


def inspect_archive(archive, tag, commit, expected=None):
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Expected an exact commit SHA")
    with tarfile.open(archive) as packed:
        members = packed.getmembers()
        names = [m.name for m in members]
        if len(names) != len(set(names)) or any(
            not m.isfile() or not m.name.startswith("package/") or ".." in Path(m.name).parts
            for m in members
        ):
            raise ValueError("Unsafe or duplicate archive member")
        if any(m.size > 2_000_000 for m in members) or sum(m.size for m in members) > 20_000_000:
            raise ValueError("Archive exceeds the reviewed size budget")
        contents = {m.name.removeprefix("package/"): packed.extractfile(m).read() for m in members}
    pkg = json.loads(contents["package.json"])
    channel = version_info(tag, pkg["version"])
    if (
        pkg["name"] != NAME
        or pkg["exports"] != {"./tui": "./tui.ts"}
        or pkg["license"] != "MIT"
        or pkg["author"]["name"] != "Yidi Sprei"
    ):
        raise ValueError("Unexpected package identity, owner, license or entrypoint")
    allowed = (
        DOCS
        | {"package.json", "schema.json", "tui.ts"}
        | {p for p in contents if re.fullmatch(r"src/[a-z-]+\.tsx?", p)}
    )
    if set(contents) != allowed:
        raise ValueError("Unexpected package contents")
    if b"Copyright (c) 2026 Yidi Sprei" not in contents["LICENSE"]:
        raise ValueError("Missing author copyright")
    if expected is not None:
        if set(contents) != set(expected):
            raise ValueError("Archive/source file sets differ")
        for path, data in contents.items():
            same = (
                json.loads(data) == json.loads(expected[path])
                if path == "package.json"
                else data == expected[path]
            )
            if not same:
                raise ValueError(f"Archive differs from tagged source: {path}")
    data = Path(archive).read_bytes()
    return {
        "formatVersion": 1,
        "name": NAME,
        "version": pkg["version"],
        "tag": tag,
        "commit": commit,
        "archive": Path(archive).name,
        "channel": channel,
        "sha256": hashlib.sha256(data).hexdigest(),
        "integrity": "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode(),
    }


def source_files(commit):
    paths = run("git", "ls-tree", "-r", "--name-only", commit, capture=True).splitlines()
    chosen = (
        DOCS
        | {"package.json", "schema.json", "tui.ts"}
        | {p for p in paths if re.fullmatch(r"src/[a-z-]+\.tsx?", p)}
    )
    return {p: subprocess.check_output(["git", "show", f"{commit}:{p}"]) for p in chosen}


def registry_version(version):
    try:
        with urllib.request.urlopen(f"{REGISTRY}/{NAME}/{version}", timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


class RegistryNotVisible(ValueError):
    """A metadata 404 after admission is not proof that publication failed."""


def verify_registry(manifest, require_provenance=False):
    data = registry_version(manifest["version"])
    if data is None:
        raise RegistryNotVisible("Registry version is not yet visible")
    if data.get("dist", {}).get("integrity") != manifest["integrity"]:
        raise ValueError("Registry version has different integrity")
    url = data["dist"]["tarball"]
    if not url.startswith(f"{REGISTRY}/{NAME}/-/"):
        raise ValueError("Unexpected registry tarball URL")
    with urllib.request.urlopen(url, timeout=60) as response:
        content = response.read(10_000_001)
    if (
        len(content) > 10_000_000
        or "sha512-" + base64.b64encode(hashlib.sha512(content).digest()).decode()
        != manifest["integrity"]
    ):
        raise ValueError("Downloaded registry archive has different bytes")
    if require_provenance and not data["dist"].get("attestations", {}).get("provenance"):
        raise ValueError("Stable publication requires registry provenance")
    return content


def wait_for_registry(manifest, require_provenance=False, attempts=12, delay=5):
    """Only repeat bounded metadata reads after a successful publish; never repeat a write."""
    if not 1 <= attempts <= 12 or not 0 <= delay <= 5:
        raise ValueError("Registry visibility wait exceeds the reviewed read budget")
    for attempt in range(attempts):
        try:
            return verify_registry(manifest, require_provenance)
        except RegistryNotVisible:
            if attempt + 1 == attempts:
                raise
            time.sleep(delay)


def ensure_no_downgrade(version, latest):
    target, current = VERSION.fullmatch(version), VERSION.fullmatch(latest)
    if target and not target[4] and latest == "0.0.0-stage":
        return  # npm's name-reservation placeholder is not an earlier stable release.
    if not target or target[4] or not current:
        raise ValueError(
            "Stable promotion requires a stable target and a recognized current version"
        )
    if tuple(map(int, target.group(1, 2, 3))) < tuple(map(int, current.group(1, 2, 3))):
        raise ValueError(
            "Refusing to downgrade latest; use the documented owner recovery procedure"
        )


def validate_context(tag, sha):
    if (
        os.environ.get("GITHUB_REPOSITORY") != REPOSITORY
        or os.environ.get("GITHUB_ACTIONS") != "true"
    ):
        raise ValueError("Automated publication is restricted to the canonical GitHub workflow")
    if os.environ.get("GITHUB_REF") != f"refs/tags/{tag}":
        raise ValueError("Dispatch retries must run on the exact release tag, not main")
    if os.environ.get("NPM_TOKEN") or os.environ.get("NODE_AUTH_TOKEN"):
        raise ValueError("Token fallback is forbidden; configure OIDC trusted publishing")
    repo = json.loads(run("gh", "api", f"repos/{REPOSITORY}", capture=True))
    if repo["private"]:
        raise ValueError("Public release requires a public source repository")
    if run("git", "rev-parse", f"refs/tags/{tag}^{{commit}}", capture=True) != sha:
        raise ValueError("Checkout does not match the version tag")
    run("git", "merge-base", "--is-ancestor", sha, "origin/main")


def checksum_file(directory, manifest):
    return (
        f"{manifest['sha256']}  {manifest['archive']}\n"
        f"{manifest['runtimeInventorySha256']}  runtime-dependencies.json\n"
        f"{hashlib.sha256((directory / 'release-manifest.json').read_bytes()).hexdigest()}  release-manifest.json\n"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "operation", choices=["validate-ref", "manifest", "publish", "fetch", "promote", "github"]
    )
    parser.add_argument("--tag", default=os.environ.get("RELEASE_TAG"))
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--directory", type=Path, default=Path(".artifacts/release"))
    args = parser.parse_args()
    directory = args.directory
    tag = args.tag
    pkg = json.loads(Path("package.json").read_text())
    version_info(tag, pkg["version"])
    check_stable_readiness(pkg["version"], json.loads(Path("release-readiness.json").read_text()))
    if "-rc." not in pkg["version"]:
        check_running_evidence(Path.cwd())
    sha = run("git", "rev-parse", "HEAD", capture=True)
    if args.operation == "validate-ref":
        validate_context(tag, sha)
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a") as output:
                output.write(f"version={pkg['version']}\n")
        return
    if args.operation == "manifest":
        directory.mkdir(parents=True, exist_ok=True)
        archive = args.archive or Path(f"{NAME}-{pkg['version']}.tgz")
        manifest = inspect_archive(archive, tag, sha, source_files(sha))
        if archive.resolve() != (directory / archive.name).resolve():
            (directory / archive.name).write_bytes(archive.read_bytes())
        inventory = directory / "runtime-dependencies.json"
        if not any(
            p.get("name") == NAME and p.get("version") == pkg["version"]
            for p in json.loads(inventory.read_text())["packages"]
        ):
            raise ValueError("Runtime inventory does not describe this tested package version")
        manifest["runtimeInventorySha256"] = hashlib.sha256(inventory.read_bytes()).hexdigest()
        (directory / "release-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        (directory / "SHA256SUMS").write_text(checksum_file(directory, manifest))
        return
    manifest = json.loads((directory / "release-manifest.json").read_text())
    if manifest["archive"] != f"{NAME}-{pkg['version']}.tgz":
        raise ValueError("Unexpected release archive filename")
    archive = directory / manifest["archive"]
    archive_manifest = {
        key: value for key, value in manifest.items() if key != "runtimeInventorySha256"
    }
    if inspect_archive(archive, tag, sha, source_files(sha)) != archive_manifest:
        raise ValueError("Release manifest/checkout/archive mismatch")
    if hashlib.sha256(
        (directory / "runtime-dependencies.json").read_bytes()
    ).hexdigest() != manifest.get("runtimeInventorySha256") or (
        directory / "SHA256SUMS"
    ).read_text() != checksum_file(directory, manifest):
        raise ValueError("Release inventory or checksums changed")
    version = manifest["version"]
    if args.operation in {"publish", "promote", "github"}:
        validate_context(tag, sha)
    if args.operation == "publish":
        if registry_version(version) is None:
            run(
                "npm",
                "publish",
                str(archive),
                "--access",
                "public",
                "--tag",
                manifest["channel"],
                "--ignore-scripts",
                f"--registry={REGISTRY}",
            )
        wait_for_registry(manifest, require_provenance=manifest["channel"] == "candidate")
    elif args.operation == "fetch":
        content = verify_registry(manifest, require_provenance=manifest["channel"] == "candidate")
        (directory / "registry.tgz").write_bytes(content)
    elif args.operation == "promote":
        verify_registry(manifest, require_provenance=manifest["channel"] == "candidate")
        if manifest["channel"] == "candidate":
            with urllib.request.urlopen(
                f"{REGISTRY}/-/package/{NAME}/dist-tags", timeout=30
            ) as response:
                latest = json.load(response).get("latest")
            if latest:
                ensure_no_downgrade(version, latest)
            run("npm", "dist-tag", "add", f"{NAME}@{version}", "latest", f"--registry={REGISTRY}")
    elif args.operation == "github":
        # A draft gets every asset before publication; immutable published assets are never replaced.
        existing = run(
            "gh",
            "release",
            "list",
            "--repo",
            REPOSITORY,
            "--json",
            "tagName,isDraft",
            "--limit",
            "100",
            capture=True,
        )
        release = next((r for r in json.loads(existing) if r["tagName"] == tag), None)
        assets = [
            archive,
            directory / "release-manifest.json",
            directory / "SHA256SUMS",
            directory / "runtime-dependencies.json",
        ]
        notes = Path("CHANGELOG.md").read_text().split(f"## {version}\n", 1)
        if len(notes) != 2:
            raise ValueError("Versioned release notes are required")
        notes_file = directory / "release-notes.md"
        notes_file.write_text(notes[1].split("\n## ", 1)[0].strip() + "\n")
        if release:
            # Safe retry: download and compare; do not --clobber immutable assets.
            check = directory / "existing-assets"
            check.mkdir(exist_ok=True)
            run(
                "gh",
                "release",
                "download",
                tag,
                "--repo",
                REPOSITORY,
                "--dir",
                str(check),
                "--skip-existing",
            )
            for asset in assets:
                if (
                    not (check / asset.name).is_file()
                    or (check / asset.name).read_bytes() != asset.read_bytes()
                ):
                    raise ValueError(
                        "Existing release assets differ or are incomplete; inspect the draft manually"
                    )
            if not release["isDraft"]:
                return
        else:
            run(
                "gh",
                "release",
                "create",
                tag,
                *map(str, assets),
                "--repo",
                REPOSITORY,
                "--verify-tag",
                "--draft",
                "--title",
                tag,
                "--notes-file",
                str(notes_file),
            )
        run(
            "gh",
            "release",
            "edit",
            tag,
            "--repo",
            REPOSITORY,
            "--draft=false",
            "--prerelease=" + str(manifest["channel"] == "next").lower(),
            "--latest=" + str(manifest["channel"] == "candidate").lower(),
        )


if __name__ == "__main__":
    main()
