# Development

Host eligibility is OpenCode 2.1.4+ without an upper version ceiling. Keep the full 2.1.4 acceptance baseline and integrity-pinned 2.2.2 forward-host smoke checks distinct from eligibility; neither certifies every future version. Newer hosts remain live-eligible unless evidence demonstrates incompatibility. Unknown state and missing API failures must remain fail-closed.

The native draft fixture advances only after a keyboard-routing handshake, native image availability, and rendered draft text. Restoration also waits for the durable corral close record and independently rendered restored text. Fixed paste/load sleeps cannot authorize a passing round trip; pure transition regressions cover delayed acknowledgements.

Native PTYs allow up to 180 seconds for database/bootstrap before a fixture becomes ready, then a separate 60-second assertion window. Slow startup does not count as protection evidence or relax any scenario assertion.

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

`bun run test:live` creates seven root sessions and three cross-directory children without model calls. Three idle roots close while selected, question-waiting, permission-waiting, and executable-queued-work roots remain; all ten sessions and waiting requests survive, then an actual restore succeeds. A genuine user inbox item is admitted with explicit `resume: false`, so it never executes; parked synthetic context remains eligible. Selection is tested while viewing a child.

`bun run test:acceptance` runs nine actual native scenarios: queued work in global/cwd layouts, disabled tabs, plugin owner replacement, unsent text/PNG close-and-restore, full private CLI/server restart, private backend disconnection/reconnection, and two competing owners in both global and distinct cwd groups. Reload/restart/reconnection grace is six seconds, exceeding the first five-second cleanup tick. Drafts are cleared locally afterward and inbox/messages must remain empty. Competing owners prove acknowledgement gating and recovery, not other-client selection safety or exactly-once closure. Each scenario has bounded waits and owns its HOME/XDG, sessions, authenticated backend, and process groups. Only a sanitized runtime-hash summary is uploaded; no terminal/server logs or session IDs.

Disconnect control waits for native key acknowledgements before suspending its idle backend. It measures at least 11.5 seconds from confirmed process suspension, verifies no close intent, then resumes the backend; a fresh public session read acknowledges recovery without relying on keyboard delivery during reconnection. Unit regressions cover lost key acknowledgements and delayed suspension. Timeout diagnostics contain only scenario/phase enums and booleans, never session IDs or transcript content.

`bun run test:package` checks the archive allowlist, installs strict production-only dependencies outside the checkout, and runs the full matrix against those installed bytes. Registry verification additionally binds installed files/lock integrity and checks signatures. This prevents fallback to development node_modules.

### Explicitly authorized running descendant

`bun run test:running:owner` prepares a private OpenCode instance and loopback-only deterministic HTTP fixture, then asks the owner to press Enter once. An explicitly authorized local agent may instead use `--authorized-agent` under AGENTS.md. Only that explicit action enables a one-shot public prompt API call to the local fixture child; no paid provider or real user state is used. The fixture holds the response for 25 seconds. Public `session.active()` must report the real child execution; its background parent must remain while eligible idle roots close, then complete successfully, become eligible, and restore. Optional protections/activity sources are disabled to isolate the hard running guard. The sanitized report binds the runtime source hash and accurately identifies human versus owner-authorized-agent initiation.

CI continues to run **only** `python3 tools/manual-running.py --setup-only`: it arms the private UI and validates the local model/child configuration, requires zero inference requests, and explicitly does **not** pass the running gate. Authorized local execution is rejected in CI. Never relabel setup-only, imported metadata, manual shell side-channels, or deterministic unit fakes as a real running execution. Keep `release-readiness.json` pending until genuine passing execution evidence is reviewed.

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

Unit/integration-style adapter tests remain deterministic fakes; they are not substituted for native evidence. `test:compat` imports empty completed/failed fixtures and verifies real native unread/error indicators without generation. The nine-scenario matrix supplies the other automated evidence above. Running descendants have a separate reviewed, explicitly authorized local-execution record in `test/evidence/running-descendants.json`; current status is recorded in `release-readiness.json`. Stable publication is machine-blocked unless every required record passes and the running record matches this runtime. Sleep/clock rollback are deterministic clock tests, not a claim of tested physical hardware suspend. Draft durability after exit and other-client selected-tab protection remain unsupported host capabilities, not passing features.
