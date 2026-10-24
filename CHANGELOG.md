# Changelog

## Unreleased

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
