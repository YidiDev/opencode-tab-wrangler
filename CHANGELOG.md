# Changelog

## Unreleased

- Centralize gap detection across manual cleanup, observations, refreshes, and asynchronous waits; distinguish intentional batch delay from suspension/oversleep.
- Retain meaningful protection transitions during cleanup without letting private hydration starve eligible tabs.
- Reject stale rule edits using transactional array/namespace comparisons, including one-click exclusions.
- Bind Corral clearing, forgetting, and restoration to the opening namespace; preserve recovery records when that context changes.

- Reverify server state after intent persistence; bound storage waits and final verification age. Storage errors/timeouts disable further writes/cleanup until reload, without replaying late writes.
- Combine conflicting unread evidence conservatively so native activity cannot mask a verified error.
- Fence candidate activity independently from unrelated busy tabs.
- Restore batches in inverse closure order and show IDs/locations in manual confirmation.
- Replace wildcard backtracking/matrix work with bounded bit-parallel matching and bounded immutable policy caches.
- Correct public vulnerability-reporting setup order and extend isolated permission/parked-context evidence.

- Bind cleanup to confirmed IDs; preserve selection activity during refresh.
- Resolve configuration once per decision pass and index recovery blockers once.
- Bound and generation-fence concurrent reads without invalidating shared host caches.
- Reclaim runtime observations/snapshots and physically prune expired durable metadata on scheduler checks.
- Validate configuration layers independently; preserve unrelated concurrent preference edits.
- Coalesce local checkpoints and harden lifecycle teardown and scheduling.
- Clarify effective preview/setup/pause states and configuration errors.
- Upgrade Solid/Seroval and add security gates.
- Add full-source coverage, lifecycle/property/race tests, installed-package CI, Python/TypeScript linting, integrity-pinned host installation, and pinned actions.
- Add contributor, security, conduct, issue, and PR guidance.

## 0.1.0 — Initial preview

Configurable policy, ordered rules, protections, locks, snoozes, pause, schedules, preview/manual/automatic modes, count/order/batch controls, and a recoverable corral. CLI-only OpenCode 2.1.4 integration with isolated live/package smoke tests.

No version has been published to npm.
