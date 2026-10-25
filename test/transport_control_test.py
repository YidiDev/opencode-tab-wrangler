"""Lost-input regression: the idle service must not freeze before native acknowledgement."""

import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "transport_control", Path(__file__).resolve().parents[1] / "tools/transport_control.py"
)
control = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(control)


class TransportControlTests(unittest.TestCase):
    def test_missing_key_acknowledgement_is_retried_before_pausing(self):
        state = control.DisconnectControl()
        self.assertEqual(state.advance("ready", 1), "arm")
        self.assertIsNone(state.advance("ready", 1.1))
        self.assertEqual(state.advance("ready", 2), "arm")
        self.assertEqual(state.advance("armed", 3), "offline")
        # Dropping that key must neither freeze the service nor stall forever.
        self.assertEqual(state.stage, 0)
        self.assertEqual(state.advance("armed", 4), "offline")
        self.assertEqual(state.advance("offline", 4.1), "pause")
        self.assertEqual(state.stage, 1)
        self.assertIsNone(state.advance("offline", 5))

    def test_full_outage_interval_is_measured_from_actual_pause(self):
        state = control.DisconnectControl()
        self.assertEqual(state.advance("offline", 10), "pause")
        self.assertIsNone(state.advance("offline-protected", 21.4))
        self.assertEqual(state.advance("offline-protected", 21.5), "resume")
        self.assertIsNone(state.advance("offline-protected", 30))
        self.assertIsNone(state.advance("recovering", 31))

    def test_stop_acknowledgement_can_reset_the_outage_clock(self):
        state = control.DisconnectControl()
        self.assertEqual(state.advance("offline", 10), "pause")
        state.paused_at = 11  # Native waitpid confirms suspension after the request.
        self.assertIsNone(state.advance("offline-protected", 21.5))
        self.assertEqual(state.advance("offline-protected", 22.5), "resume")
