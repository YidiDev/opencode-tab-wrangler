"""Native acknowledgement-driven draft round trip; no fixed paste/load assumptions."""

from dataclasses import dataclass


@dataclass
class DraftControl:
    stage: int = 0
    key_at: float = 0

    def advance(self, phase, now, text_visible=False, close_confirmed=False):
        if self.stage == 0:
            if phase == "input-ready":
                self.stage = 2
                return "image"
            if phase == "ready" and now >= self.key_at:
                self.key_at = now + 1
                return "arm"
        elif self.stage == 2 and phase == "attachment-ready":
            self.stage = 3
            return "text"
        elif self.stage == 3 and text_visible:
            self.stage = 4
            return "close"
        elif self.stage == 4 and phase == "closed" and close_confirmed:
            self.stage = 5
            return "restore"
        elif self.stage == 5 and phase == "restored" and text_visible:
            self.stage = 6
            return "clear"
        return None
