"""Acknowledged control of an isolated idle backend; no native/session effects here."""


class DisconnectControl:
    def __init__(self):
        self.stage = 0
        self.key_at = 0.0
        self.paused_at = 0.0

    def advance(self, phase, now):
        if self.stage == 0:
            # Never freeze the service before the CLI acknowledges the offline key.
            if phase == "offline":
                self.stage, self.paused_at = 1, now
                return "pause"
            if phase in {"ready", "armed"} and now >= self.key_at:
                self.key_at = now + 1
                return "arm" if phase == "ready" else "offline"
        elif self.stage == 1 and phase == "offline-protected" and now - self.paused_at >= 11.5:
            self.stage = 2
            return "resume"
        return None
