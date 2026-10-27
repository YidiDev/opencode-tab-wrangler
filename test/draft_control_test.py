"""Draft round trips cannot advance on guessed load delays or admission alone."""

import importlib.util
import sys
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "draft_control", Path(__file__).resolve().parents[1] / "tools/draft_control.py"
)
module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = module
SPEC.loader.exec_module(module)


class DraftControlTests(unittest.TestCase):
    def test_waits_for_native_image_and_rendered_text_before_closing(self):
        control = module.DraftControl()
        self.assertEqual(control.advance("ready", 0), "arm")
        self.assertIsNone(control.advance("ready", 0.5))
        self.assertEqual(control.advance("ready", 1), "arm")
        self.assertEqual(control.advance("input-ready", 2), "image")
        self.assertIsNone(control.advance("input-ready", 100))
        self.assertEqual(control.advance("attachment-ready", 101), "text")
        self.assertIsNone(control.advance("attachment-ready", 200))
        self.assertEqual(control.advance("attachment-ready", 201, text_visible=True), "close")

    def test_restore_requires_durable_close_and_clear_requires_restored_text(self):
        control = module.DraftControl(stage=4)
        self.assertIsNone(control.advance("closed", 0))
        self.assertEqual(control.advance("closed", 1, close_confirmed=True), "restore")
        self.assertIsNone(control.advance("restored", 2))
        self.assertEqual(control.advance("restored", 3, text_visible=True), "clear")
        self.assertEqual(control.stage, 6)
        self.assertIsNone(control.advance("restored", 4, text_visible=True))
