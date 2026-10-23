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
- `rules-ui.ts`: guided ordered-rule creation and editing.

No internal host renderable traversal, filesystem access, monkey patches, or server plugin. Import host types with `import type`; only the entrypoint imports the runtime `Plugin` helper. The terminal's own Solid/OpenTUI runtime owns UI execution.

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
9. Before changing visibility, prepare a verified fallback private contact and scan all Git history with a dedicated tool such as `gitleaks git --redact --log-opts="--all" .`. Immediately when public, enable and verify GitHub private vulnerability reporting, appropriate secret scanning, and required `quality`/`installed-package` checks on `main`. Authorize Renovate if desired. Branch protection is currently unavailable under the private repository's account plan; do not claim it is configured. No workflow automatically publishes packages or changes visibility.

## Reviewed host behavior (2.1.4 source)

Public API types: `packages/plugin/src/tui/context.ts`. Tab adapter: `packages/tui/src/plugin/api.tsx`. Shared persistent layout, root unread, and family attention/busy logic: `packages/tui/src/context/session-tabs.tsx`. Draft stash: `packages/tui/src/component/prompt/draft-stash.ts`. Local directories are resolved by root filename (`tui.ts`), while npm packages use the `./tui` export; both entrypoints are provided and the actual host resolver has a regression test.

These were reviewed at tag `v2.1.4`, not inferred from moving `dev`. Draft storage is memory-only. Tab removal uses asynchronous host storage; a true boolean is admission, not confirmed persistence. There is no atomic conditional close, per-client tab lease, or trusted connected-server identifier in the public plugin context.

## State evolution

State version 1 stores preferences, locks keyed by `[connectionKey, sessionID]`, and corral entries. Future migrations must be explicit and tested; unknown versions currently disable the plugin without overwriting state. Recovery never automatically repeats an ambiguous close.

## Remaining compatibility evidence

Unit/integration-style adapter tests are deterministic fakes. Live tests prove loading, dialog rendering, idle closure, selected/question/permission protection, parked-context eligibility, session preservation, and restoration from both checkout and production-only archive. Unread/error, executable queued work, running descendant, draft, disconnection, and multi-client behavior still need broader live matrix evidence. Multi-client selection is an acknowledged limitation, not implemented protection. Full live matrix items above remain required before describing the package as production-certified or publishing it broadly.
