"""Release safety tests: no real registry writes, tags, or GitHub effects."""

import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import tarfile
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "release", Path(__file__).resolve().parents[1] / "tools/release.py"
)
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        Path(".artifacts").mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=".artifacts")
        self.addCleanup(self.temp.cleanup)
        self.archive = Path(self.temp.name) / "test.tgz"
        self.files = {path: b"documentation" for path in release.DOCS}
        self.files.update(
            {
                "tui.ts": b'export {default} from "./src/tui"',
                "src/tui.tsx": b"export default {}",
                "schema.json": b"{}",
                "LICENSE": b"Copyright (c) 2026 Yidi Sprei",
            }
        )
        self.pkg = {
            "name": release.NAME,
            "version": "1.0.0-rc.1",
            "exports": {"./tui": "./tui.ts"},
            "license": "MIT",
            "author": {"name": "Yidi Sprei"},
        }
        self.files["package.json"] = json.dumps(self.pkg).encode()
        self.sha = "a" * 40

    def pack(self, extra=None):
        with tarfile.open(self.archive, "w:gz") as packed:
            for name, value in self.files.items():
                entry = tarfile.TarInfo(f"package/{name}")
                entry.size = len(value)
                packed.addfile(entry, io.BytesIO(value))
            if extra:
                packed.addfile(extra)

    def inspect(self):
        self.pack()
        return release.inspect_archive(self.archive, "v1.0.0-rc.1", self.sha, self.files)

    def test_channels_and_exact_versions(self):
        self.assertEqual(release.version_info("v1.0.0", "1.0.0"), "candidate")
        self.assertEqual(release.version_info("v1.0.0-rc.1", "1.0.0-rc.1"), "next")
        for tag, version in [
            ("v1", "1.0.0"),
            ("v1.0.0", "1.0.1"),
            ("v01.0.0", "01.0.0"),
            ("v1.0.0-beta.1", "1.0.0-beta.1"),
            ("v1.0.0;evil", "1.0.0;evil"),
        ]:
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                release.version_info(tag, version)

    def test_stable_requires_explicit_complete_evidence(self):
        release.check_stable_readiness("1.0.0-rc.2", {})
        with self.assertRaises(ValueError):
            release.check_stable_readiness("1.0.0", {})
        policy = {
            "host": "2.1.4",
            "platform": "linux-x64",
            "stableRequirements": {
                name: {"status": "passed", "evidence": "reviewed isolated fixture evidence"}
                for name in release.REQUIREMENTS
            },
        }
        release.check_stable_readiness("1.0.0", policy)
        policy["stableRequirements"]["running-descendants"]["evidence"] = ""
        with self.assertRaises(ValueError):
            release.check_stable_readiness("1.0.0", policy)

    def test_manifest_matches_exact_source_and_bytes(self):
        result = self.inspect()
        self.assertEqual(result["sha256"], hashlib.sha256(self.archive.read_bytes()).hexdigest())
        self.files["tui.ts"] = b"changed"
        with self.assertRaises(ValueError):
            release.inspect_archive(self.archive, "v1.0.0-rc.1", self.sha, self.files)

    def test_no_traversal_links_duplicates_or_extra_files(self):
        for name, kind in [
            ("package/../secret", tarfile.REGTYPE),
            ("/absolute", tarfile.REGTYPE),
            ("package/LICENSE", tarfile.REGTYPE),
            ("package/link", tarfile.SYMTYPE),
            ("package/.npmrc", tarfile.REGTYPE),
        ]:
            with self.subTest(name=name):
                extra = tarfile.TarInfo(name)
                extra.type = kind
                self.pack(extra)
                with self.assertRaises(ValueError):
                    release.inspect_archive(self.archive, "v1.0.0-rc.1", self.sha)

    def test_identity_copyright_and_docs_are_required(self):
        original = dict(self.files)
        for key in ["LICENSE", "THIRD_PARTY_NOTICES.md", "RELEASING.md"]:
            self.files = dict(original)
            del self.files[key]
            self.pack()
            with self.assertRaises((ValueError, KeyError)):
                release.inspect_archive(self.archive, "v1.0.0-rc.1", self.sha)
        self.files = original
        self.pkg["author"]["name"] = "unexpected"
        self.files["package.json"] = json.dumps(self.pkg).encode()
        with self.assertRaises(ValueError):
            self.inspect()

    def test_registry_only_404_means_unpublished(self):
        for status in [404, 403, 500]:
            with patch.object(
                release.urllib.request,
                "urlopen",
                side_effect=urllib.error.HTTPError("url", status, "test", {}, None),
            ):
                if status == 404:
                    self.assertIsNone(release.registry_version("1.0.0"))
                else:
                    with self.assertRaises(urllib.error.HTTPError):
                        release.registry_version("1.0.0")

    def test_registry_integrity_and_provenance(self):
        manifest = self.inspect()
        data = {
            "dist": {
                "integrity": manifest["integrity"],
                "tarball": release.REGISTRY + "/" + release.NAME + "/-/test.tgz",
            }
        }
        with (
            patch.object(release, "registry_version", return_value=data),
            patch.object(
                release.urllib.request,
                "urlopen",
                return_value=io.BytesIO(self.archive.read_bytes()),
            ),
        ):
            self.assertEqual(release.verify_registry(manifest), self.archive.read_bytes())
        with (
            patch.object(release, "registry_version", return_value=data),
            patch.object(
                release.urllib.request,
                "urlopen",
                return_value=io.BytesIO(self.archive.read_bytes()),
            ),
            self.assertRaisesRegex(ValueError, "provenance"),
        ):
            release.verify_registry(manifest, True)
        data["dist"]["integrity"] = "sha512-" + base64.b64encode(b"wrong").decode()
        with (
            patch.object(release, "registry_version", return_value=data),
            self.assertRaises(ValueError),
        ):
            release.verify_registry(manifest)

    def test_no_automatic_latest_downgrade(self):
        release.ensure_no_downgrade("1.10.0", "1.9.9")
        release.ensure_no_downgrade("1.0.0", "0.0.0-stage")
        release.ensure_no_downgrade("1.0.0", "1.0.0")
        for version, latest in [("1.0.0", "2.0.0"), ("1.0.0-rc.1", "1.0.0"), ("evil", "1.0.0")]:
            with self.assertRaises(ValueError):
                release.ensure_no_downgrade(version, latest)

    def test_context_rejects_forks(self):
        with (
            patch.dict(
                release.os.environ,
                {"GITHUB_REPOSITORY": "fork/repo", "GITHUB_ACTIONS": "true"},
                clear=True,
            ),
            self.assertRaises(ValueError),
        ):
            release.validate_context("v1.0.0", self.sha)

    def operation_fixture(self, version="1.0.0-rc.1"):
        root = Path(self.temp.name).resolve()
        self.pkg["version"] = version
        self.files["package.json"] = json.dumps(self.pkg).encode()
        self.files["CHANGELOG.md"] = f"## {version}\n\nFixture release notes.\n".encode()
        self.archive = root / f"{release.NAME}-{version}.tgz"
        self.pack()
        manifest = release.inspect_archive(self.archive, f"v{version}", self.sha, self.files)
        directory = root / "release"
        directory.mkdir(exist_ok=True)
        (directory / self.archive.name).write_bytes(self.archive.read_bytes())
        inventory = directory / "runtime-dependencies.json"
        inventory.write_text(
            json.dumps({"packages": [{"name": release.NAME, "version": version, "license": "MIT"}]})
        )
        manifest["runtimeInventorySha256"] = hashlib.sha256(inventory.read_bytes()).hexdigest()
        (directory / "release-manifest.json").write_text(json.dumps(manifest))
        (directory / "SHA256SUMS").write_text(release.checksum_file(directory, manifest))
        (root / "package.json").write_bytes(self.files["package.json"])
        (root / "CHANGELOG.md").write_bytes(self.files["CHANGELOG.md"])
        (root / "release-readiness.json").write_text(
            json.dumps(
                {
                    "host": "2.1.4",
                    "platform": "linux-x64",
                    "stableRequirements": {
                        name: {"status": "passed", "evidence": "unit fixture only"}
                        for name in release.REQUIREMENTS
                    },
                }
            )
        )
        return root, directory

    @contextlib.contextmanager
    def operation(self, operation, version="1.0.0-rc.1", npm_failure=False):
        root, directory = self.operation_fixture(version)
        calls = []

        def fake_run(*args, **kwargs):
            calls.append(args)
            if args[:3] == ("git", "rev-parse", "HEAD"):
                return self.sha
            if args[:3] == ("gh", "release", "list"):
                return "[]"
            if args[0] == "npm" and npm_failure:
                raise release.subprocess.CalledProcessError(1, args)
            return None

        with (
            contextlib.chdir(root),
            patch(
                "sys.argv",
                ["release.py", operation, "--tag", f"v{version}", "--directory", str(directory)],
            ),
            patch.object(release, "run", side_effect=fake_run),
            patch.object(release, "source_files", return_value=self.files),
            patch.object(release, "validate_context") as context,
            patch.object(release, "verify_registry", return_value=b"fixture") as verify,
            patch.object(release, "registry_version", return_value=None) as registry,
        ):
            yield calls, context, verify, registry, directory

    def test_publish_runs_once_without_lifecycle_scripts(self):
        with self.operation("publish") as (calls, context, verify, _, _):
            release.main()
            effects = [call for call in calls if call[0] == "npm"]
            self.assertEqual(len(effects), 1)
            self.assertIn("--ignore-scripts", effects[0])
            self.assertIn("next", effects[0])
            context.assert_called_once()
            verify.assert_called_once()

    def test_ambiguous_publish_failure_is_never_retried(self):
        with self.operation("publish", npm_failure=True) as (calls, _, verify, _, _):
            with self.assertRaises(release.subprocess.CalledProcessError):
                release.main()
            self.assertEqual(len([c for c in calls if c[0] == "npm"]), 1)
            verify.assert_not_called()

    def test_existing_version_is_verified_not_republished(self):
        with self.operation("publish") as (calls, _, verify, registry, _):
            registry.return_value = {"dist": {"integrity": "existing"}}
            release.main()
            self.assertFalse(any(c[0] == "npm" for c in calls))
            verify.assert_called_once()
        with self.operation("publish") as (calls, _, verify, registry, _):
            registry.return_value = {"dist": {"integrity": "different"}}
            verify.side_effect = ValueError("mismatched bytes")
            with self.assertRaises(ValueError):
                release.main()
            self.assertFalse(any(c[0] == "npm" for c in calls))

    def test_fetch_failure_does_not_record_success(self):
        with self.operation("fetch") as (_, _, verify, _, directory):
            verify.side_effect = ValueError("registry unavailable")
            with self.assertRaises(ValueError):
                release.main()
            verify.assert_called_once()
            self.assertFalse((directory / "registry.tgz").exists())

    def test_rc_never_promotes_latest(self):
        with self.operation("promote") as (calls, _, verify, _, _):
            release.main()
            verify.assert_called_once()
            self.assertFalse(any(c[0] == "npm" for c in calls))

    def test_stable_promotion_refuses_downgrade(self):
        with (
            self.operation("promote", version="1.0.0") as (calls, _, _, _, _),
            patch.object(
                release.urllib.request, "urlopen", return_value=io.BytesIO(b'{"latest":"2.0.0"}')
            ),
        ):
            with self.assertRaisesRegex(ValueError, "downgrade"):
                release.main()
            self.assertFalse(any(c[0] == "npm" for c in calls))

    def test_github_assets_are_attached_before_immutable_publication(self):
        with self.operation("github") as (calls, _, _, _, _):
            release.main()
            create = next(i for i, c in enumerate(calls) if c[:3] == ("gh", "release", "create"))
            edit = next(i for i, c in enumerate(calls) if c[:3] == ("gh", "release", "edit"))
            self.assertLess(create, edit)
            self.assertIn("--draft", calls[create])
            self.assertIn("--verify-tag", calls[create])
            self.assertFalse(any("--clobber" in c for c in calls))

    def test_context_rejects_tokens_private_source_and_moved_tags(self):
        for private in [False, True]:
            with (
                patch.dict(
                    release.os.environ,
                    {
                        "GITHUB_REPOSITORY": release.REPOSITORY,
                        "GITHUB_ACTIONS": "true",
                        "GITHUB_REF": "refs/tags/v1.0.0",
                    },
                    clear=True,
                ),
                patch.object(
                    release, "run", side_effect=[json.dumps({"private": private}), "b" * 40]
                ),
                self.assertRaises(ValueError),
            ):
                release.validate_context("v1.0.0", self.sha)
        with (
            patch.dict(
                release.os.environ,
                {
                    "GITHUB_REPOSITORY": release.REPOSITORY,
                    "GITHUB_ACTIONS": "true",
                    "GITHUB_REF": "refs/tags/v1.0.0",
                    "NPM_TOKEN": "not-a-real-token",
                },
                clear=True,
            ),
            self.assertRaisesRegex(ValueError, "fallback"),
        ):
            release.validate_context("v1.0.0", self.sha)


if __name__ == "__main__":
    unittest.main()
