# Changelog

## 1.0.0-rc.2

- First prepared public v1 candidate, authored and maintained by Yidi Sprei (YidiDev), MIT-licensed with explicit third-party notices.
- Preview-first capped defaults: minimum 3, soft maximum 8, over-limit cleanup, two-tab batches; all protections remain enabled.
- Removed runtime SDK/OpenTUI dependencies; a strict npm consumer installs only the required validation/reactivity libraries.
- Added verified-archive, OIDC, registry-install and immutable GitHub release automation with a single approval gate and no stored npm token.
- Existing state schema remains version 1. Explicit saved/file preferences take precedence over new defaults; upgrades reset grace and never grant shared-layout acknowledgement.
- Supported host remains OpenCode 2.1.4 on Linux x64. Other-client selection and atomic conditional closing are not available from the public host API. Broader stable-release evidence remains tracked in DEVELOPMENT.md.

## 1.0.0-rc.1

- Unapproved npm staging artifact used only to reserve the global package name. No candidate source was publicly published from that stage. Do not approve/install this reservation artifact.

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
