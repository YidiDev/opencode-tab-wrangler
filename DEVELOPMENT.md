# Development

## Boundaries

- `config.ts`: strict options schema, safe merge, glob matching, rule resolution, local schedule.
- `policy.ts`: pure observations, protection reasons, eligibility, count/order/batch selection.
- `host.ts`: only OpenCode API adapter; never approve, interrupt, delete, or generate.
- `controller.ts`: serialized refresh/check/persist/close/confirm pipeline and recovery.
- `state.ts`: versioned durable state and bounded retention.
- `ui.ts`: built-in searchable dialogs, toggles, JSON editing, confirmation and recovery workflows.
- `tui.tsx`: host lifecycle, commands, subscriptions, scheduler, cleanup.
- `clock.ts`: cancellable sleeps; unloading disarms pending batch/verification timers.
- `observation-clock.ts`: wall/monotonic gap detection and explicit intentional-wait allowances, shared by all controller entrypoints.
- `rules-ui.ts`: guided ordered-rule creation and editing.

No internal host renderable traversal, filesystem access, monkey patches, or server plugin. All SDK imports are type-only. The default export is a typed public plugin definition, not a runtime SDK import. Consumers need only Zod and the Solid peer; SDK/OpenTUI packages are development/host tooling, not production dependencies. This avoids forcing OpenTUI's obsolete Solid development pin into a clean consumer installation. The terminal's own UI owns renderables.

## Commands

`bun run check` checks formatting, ESLint, TypeScript, generated-schema parity, and tests. `bun run schema` regenerates the JSON schema; commit it with schema changes. `bun pm pack` produces the distributable archive. Use the frozen lockfile in CI. Python harnesses use pinned Ruff (`requirements-dev.txt`); see `CONTRIBUTING.md` for virtualenv setup.

`bun run test:coverage` explicitly loads every production module, including lifecycle wiring. Bun applies coverage floors and `tools/coverage.ts` separately verifies every source file plus production-only aggregate floors. LCOV is evidence, not branch-completeness proof; no branch coverage percentage is claimed.

`bun run test:security` runs a deliberately limited credential-pattern scanner and `bun audit`. There are no audit suppressions. The hosted installed-package job obtains the exact native `@opencode/cli-linux-x64@2.1.4` archive through `tools/install-host.py`, verifies its committed SHA-512 SRI, then extracts only the allowed executable. It never pipes a mutable installer into a shell.

`python3 tools/pty-smoke.py` is an explicit, isolated dialog smoke test. It requires installed OpenCode 2.1.4 and Python 3 on Linux. It starts only its own `--standalone` server, isolates XDG directories and the test HOME, uses a temporary project, loads this checkout in preview mode, and captures terminal output under ignored `.artifacts/`. It does not use API credentials or submit a model prompt. The process is terminated afterward.

`bun run test:live` additionally loads a disposable fixture plugin, creates six root sessions and two cross-directory children without model calls, verifies three idle tabs close automatically while selected, question-waiting, and permission-waiting roots stay open, verifies all eight sessions and waiting requests still exist, and restores/focuses a closed tab through Wrangler's real palette command. One idle session has parked synthetic context (`resume: false`); it must still be eligible. Selection is tested while viewing a child; idle/grace intervals are nonzero. `bun run test:package` verifies an exact runtime/doc archive allowlist, extracts outside the repository, installs only production dependencies, and repeats the same live assertions. This prevents accidental fallback to development node_modules. These targeted tests do not certify the entire live matrix below.

## Release gates

GitHub Actions enforces quality/security/coverage plus source and production-only installed-package live tests on pushes and PRs. Actions are SHA-pinned, permissions minimal, jobs timed out, and superseded runs cancelled. Raw terminal/server logs are not uploaded. Weekly runs repeat these checks; they do not silently widen host support. CodeQL is public-only until private scanning entitlement is available.

1. Run all checks, schema parity, package inspection, and isolated live loading.
2. Confirm unread `activity` and `error` map to the host strip.
3. Confirm root selected status while viewing a child; running/permission/form/pending descendant protection, including other directories.
4. Exercise manual and automatic cleanup in an isolated terminal using synthetic sessions, never real user sessions.
5. Check close/reopen preserves draft and prompt attachments in that host version; no claims of durability after exit.
6. Test disconnect, server restart, sleep, hot reload, tabs disabled, global/cwd scope, and competing TUI instances. Do not claim other-client selected-tab safety: public API does not provide it.
7. Validate packed CLI-only entrypoint with no project `node_modules` fallback.
8. Document residual conditional-close races and any unsupported scenario. Do not widen the exact host-version gate without this evidence.
9. Before changing visibility, prepare a verified fallback private contact and scan all Git history with `gitleaks git --redact --log-opts="--all" .`. Immediately when public, enable and verify GitHub private vulnerability reporting, appropriate secret scanning, and required `quality`/`installed-package`/`analyze` checks. Authorize Renovate if desired. Do not claim branch protection is configured until verified. The explicit version-tag workflow publishes through OIDC only after gates and approval; see RELEASING.md. It never changes repository visibility.

## Reviewed host behavior (2.1.4 source)

Public API types: `packages/plugin/src/tui/context.ts`. Tab adapter: `packages/tui/src/plugin/api.tsx`. Shared persistent layout, root unread, and family attention/busy logic: `packages/tui/src/context/session-tabs.tsx`. Draft stash: `packages/tui/src/component/prompt/draft-stash.ts`. Local directories are resolved by root filename (`tui.ts`), while npm packages use the `./tui` export; both entrypoints are provided and the actual host resolver has a regression test.

These were reviewed at tag `v2.1.4`, not inferred from moving `dev`. Draft storage is memory-only. Tab removal uses asynchronous host storage; a true boolean is admission, not confirmed persistence. There is no atomic conditional close, per-client tab lease, or trusted connected-server identifier in the public plugin context.

## State evolution

State version 1 stores preferences, locks keyed by `[connectionKey, sessionID]`, and corral entries. Future migrations must be explicit and tested; unknown versions currently disable the plugin without overwriting state. Recovery never automatically repeats an ambiguous close.

UI rule mutations carry the opening effective array and namespace for transactional optimistic comparison. Corral clearing/forgetting also validates the opening namespace inside the write transaction. Known validation conflicts do not latch storage-fault mode. In tests, `h.age(ms)` models elapsed idle time with periodic observations; `h.advance(ms)` deliberately advances the clock without observation and is appropriate for gap, suspension, and rollback cases. Race tests must assert that their target phase was reached, rather than passing because startup/gap grace prevented execution entirely.

## Remaining compatibility evidence

Unit/integration-style adapter tests are deterministic fakes. Live tests prove loading, dialog rendering, idle closure, selected/question/permission protection, parked-context eligibility, session preservation, and restoration from both checkout and production-only archive. `test:compat` additionally imports empty completed/failed fixture sessions through the public API and verifies the real native activity/error indicators protect their tabs while an idle tab closes. It does not simulate or invoke model generation. Executable queued work, running descendants, drafts/attachments, disconnect/restart/reload, scopes and competing clients still need broader live evidence, tracked in `release-readiness.json`. Stable publication is machine-blocked until those required records pass with evidence. Multi-client selection remains an acknowledged API limitation, never implemented protection. RC publication is not production certification.
