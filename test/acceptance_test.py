"""Acceptance orchestration contracts; these tests never start generation."""

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


acceptance = module("acceptance", ROOT / "tools/acceptance.py")
with patch.dict(sys.modules, {"acceptance": acceptance}):
    manual = module("manual_running", ROOT / "tools/manual-running.py")


class AcceptanceTests(unittest.TestCase):
    def test_bootstrap_allowance_does_not_shorten_or_renew_assertion_window(self):
        budget = acceptance.NativeBudget(0)
        budget.observe("starting", 120)
        self.assertEqual(budget.deadline, 180)
        budget.observe("ready", 150)
        self.assertEqual(budget.deadline, 210)
        budget.observe("restoring", 190)
        self.assertEqual(budget.deadline, 210)

    def test_other_platforms_cannot_be_mislabeled_as_supported_evidence(self):
        with patch.object(sys, "platform", "darwin"), self.assertRaises(SystemExit):
            acceptance.require_platform()

    def test_all_native_scenarios_are_present_without_running_submission(self):
        self.assertEqual(
            [name for name, _ in acceptance.SCENARIOS],
            [
                "queued-global",
                "queued-cwd",
                "disabled",
                "reload",
                "draft",
                "restart",
                "disconnect",
                "competing-global",
                "competing-cwd",
            ],
        )
        self.assertNotIn("running", str(acceptance.SCENARIOS))

    def test_runtime_hash_changes_with_runtime_not_version_or_docs(self):
        (ROOT / ".artifacts").mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT / ".artifacts") as temp:
            root = Path(temp)
            (root / "src").mkdir()
            (root / "tui.ts").write_text("entry")
            source = root / "src/host.ts"
            source.write_text("first")
            before = acceptance.runtime_hash(root)
            (root / "package.json").write_text('{"version":"1.0.0"}')
            self.assertEqual(before, acceptance.runtime_hash(root))
            source.write_text("second")
            self.assertNotEqual(before, acceptance.runtime_hash(root))

    def test_owner_submission_rejects_noninteractive_agent_or_ci_before_effects(self):
        with (
            patch("sys.argv", ["manual-running.py"]),
            patch.object(sys.stdin, "isatty", return_value=False),
            patch.object(manual.subprocess, "Popen") as native,
            self.assertRaises(SystemExit),
        ):
            manual.main()
        native.assert_not_called()

    def test_authorized_agent_is_explicit_and_never_allowed_in_ci(self):
        with (
            patch("sys.argv", ["manual-running.py", "--authorized-agent"]),
            patch.dict(manual.os.environ, {"CI": "true"}),
            patch.object(manual.subprocess, "Popen") as native,
            self.assertRaises(SystemExit),
        ):
            manual.main()
        native.assert_not_called()
