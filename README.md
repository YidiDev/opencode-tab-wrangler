# OpenCode Tab Wrangler

**Stable v1:** `1.0.0`, verified for OpenCode 2.1.4 on Linux x64. See [GitHub Releases](https://github.com/YidiDev/opencode-tab-wrangler/releases) and the [release policy](RELEASING.md).

Configurable tab housekeeping for the **OpenCode 2.1.4 terminal**, inspired by the independent [Tab Wrangler browser extension](https://github.com/tabwrangler/tabwrangler). Keep tabs that matter; corral the rest without deleting their sessions.

Defaults to preview mode. The production plugin makes no model calls and adds no backend service, MCP server, telemetry, or access to transcript contents.

**Author and maintainer: Yidi Sprei ([YidiDev](https://github.com/YidiDev)). Copyright © 2026 Yidi Sprei.** Original project material is MIT-licensed; third-party rights and notices remain separate. See [attribution and acknowledgements](THIRD_PARTY_NOTICES.md).

**Compatibility:** OpenCode **2.1.4** only; automated/live evidence is Linux x64 with Bun **1.4.0**. Other platforms are unverified. Keep automatic cleanup in a single terminal when possible. This is not a replacement tab strip or a cross-terminal pinning system.

## Install v1

The unscoped npm name **`opencode-tab-wrangler`** belongs to npm account **`yididev`**. Do not install the `0.0.0-stage` name-reservation placeholder or treat a previous RC as the final release.

Merge into global `~/.config/opencode/cli.json`:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [{ "package": "opencode-tab-wrangler@1.0.0", "options": {} }]
}
```

The exact version pins a reproducible installation; use `@latest` instead to track stable releases. Version 1.x describes this plugin, **not** compatibility with OpenCode V1. Preserve unrelated plugins. Do not add a duplicate local/npm registration.

## Install locally

```sh
git clone https://github.com/YidiDev/opencode-tab-wrangler.git
cd opencode-tab-wrangler
bun install --frozen-lockfile
bun run check
```

Add the local checkout to your **global** `~/.config/opencode/cli.json` (merge with your existing plugins):

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-tab-wrangler",
      "options": {}
    }
  ]
}
```

Use your own absolute checkout path if different. OpenCode reloads CLI configuration when it changes. Run `/wrangler` or choose **Tab Wrangler** from the command palette. Don't register the same package twice. This plugin has only a `./tui` entrypoint; it does not belong in server configuration.

The plugin **does not install or enable itself**, and this repository does not change your OpenCode settings. Other OpenCode versions are rejected safely until tested.

## First use

1. Inspect **Open tabs / protection inspector**. Preview never closes tabs by itself.
2. In **Settings**, choose a unique `connectionKey` for this server, such as `local-main`.
3. Read the shared-tab warning and enable `acknowledgeSharedTabs` only if appropriate.
4. Try **Preview and clean eligible tabs** for a confirmed manual batch.
5. Set `mode` to `auto` when satisfied. All protections remain enabled by default.

If nothing is eligible, inspect the stated protection reasons. Defaults are minimum **3**, soft maximum **8**, **over-limit** cleanup, batches of **2**, and 30-minute idle/grace intervals. Over-limit cleanup retains eight tabs unless you choose different limits; the minimum is a separate hard floor. Preview mode never closes automatically. The manager explicitly reports setup-blocked, paused, off, scheduled, or automatic status.

### A typical workflow

1. `/wrangler` → **Open tabs / protection inspector** → choose a tab to see its idle time, matched rules, and protection reasons.
2. Lock an important session, or exclude its project/directory.
3. **Preview and clean eligible tabs** shows exactly which IDs may close. If state changes during confirmation, tabs can be skipped but never substituted.
4. **Corral** reopens a session without rerunning its prompt; **Wrangler: reopen last closed tab** is the quick recovery command.

### Important safety limitations

- Closing means **removing a tab only**. No session delete, archive, interrupt, question-answer, or permission-approval APIs are used.
- The locally selected tab, running work in its family, unresolved busy state, unknown state, and explicitly locked tabs are protected.
- **OpenCode shares tab layouts across terminal instances. Other terminals' selected tabs are not visible through the plugin API.** The acknowledgement is not a cross-terminal lock. Prefer running automatic cleanup in one terminal, with no competing clients managing the same layout. If that limitation is unacceptable, remain in preview mode.
- Unread state uses OpenCode's native indicator. Viewed state is server-global: reading a session in another client can clear unread here. Root unread state reflects root completion, while child waiting/running states are checked separately.
- Fresh public API reads plus a final synchronous local recheck reduce races. There is **no atomic conditional-close API**: execution or a question can begin after the last server response and before its event reaches this terminal.
- The host tab API acknowledges a close request before disk persistence completes. Wrangler waits for disappearance. If it cannot confirm the result, it records `uncertain` and will not automatically retry that session while the entry remains in retained history.
- Drafts are preserved in memory by OpenCode across prompt remounts in 2.1.4. Wrangler does not read or store drafts, and cannot make them durable across application exit. Closing tabs is not a draft backup mechanism.
- `connectionKey` is a **user-supplied namespace**, not detected server identity. Change it when connecting to another server; do not reuse it for unrelated servers. History cannot be safely mapped across servers automatically.

## Controls

| Palette command                  | Purpose                                                                |
| -------------------------------- | ---------------------------------------------------------------------- |
| Tab Wrangler (`/wrangler`)       | Open the manager                                                       |
| Wrangler: inspect tabs           | Search open tabs and inspect all protection reasons                    |
| Wrangler: clean eligible tabs    | Preview and confirm one safe batch                                     |
| Wrangler: open corral            | Search/reopen closed tabs, restore all, forget entries                 |
| Wrangler: settings               | Edit settings, nested toggles, ordered rules, or full preferences JSON |
| Wrangler: pause / resume         | Pause indefinitely, for a preset, or for custom minutes                |
| Wrangler: reopen last closed tab | Restore the most recent retained entry                                 |

No shortcuts are taken by default. The command IDs are `wrangler.open`, `wrangler.preview`, `wrangler.cleanup`, `wrangler.corral`, `wrangler.settings`, `wrangler.pause`, and `wrangler.restore`. Bind them in `cli.json` under `keybinds`, for example `"wrangler.open": "ctrl+g"` if that shortcut is available in your setup.

Open-tab details offer permanent locks, temporary snoozes, unlock, focus, and one-click exclusions for the session/project/directory. One-click exclusions are prepended as stopping rules so they take precedence. These are **logical locks** in Wrangler, not native pins or a replacement tab strip. They do not prevent you from closing a tab yourself. Temporary locks and pauses accept positive durations up to one year.

The Corral's footer actions are **Ctrl+R** (restore all, with confirmation) and **Ctrl+X** (clear this connection's history, with confirmation). Restore one entry in the background or focus it. Already-open tabs aren't duplicated or moved. Unavailable sessions retain their history entry. Forgetting an entry never deletes a session.

Restore all undoes the latest removals first, preserving the order of an unchanged batch. User reordering, expired/forgotten entries, and competing terminals can prevent reconstruction of an earlier layout.

Corral actions are bound to the namespace displayed when the dialog opened. Clearing or forgetting entries validates that namespace inside the storage transaction; a changed connection requires reopening Corral rather than acting on another namespace's recovery records.

## Configuration

All properties below live inside the plugin's `options` object. The generated [`schema.json`](schema.json) describes those options, not the entire `cli.json` file.

Precedence: **defaults → saved UI preferences → explicit file options**. Nested objects merge; arrays replace. File-controlled fields are read-only in the UI. A partial file-controlled object still allows editing its other fields. Changes grant a fresh grace period. Reset UI preferences by editing **all UI preferences as JSON** to `{}`; this doesn't remove file overrides, locks, or history.

Each layer is validated independently, so an invalid saved value cannot hide behind a valid file override. Ordinary UI edits patch the latest durable preferences transactionally, preserving unrelated concurrent edits. Editing all preferences as JSON intentionally replaces them.

Rule edits additionally compare the opening rules and connection namespace against the latest transaction state. If another terminal changed either, the edit is rejected without overwriting it; reopen Rules and retry. This also applies to one-click exclusions.

Invalid settings, unsupported state versions, or recovery-storage failures disable the plugin without closing tabs. Unknown setting names are rejected, not ignored. There is no arbitrary code/regex policy execution.

### General settings

| Option                  | Default          | Meaning                                                                                |
| ----------------------- | ---------------- | -------------------------------------------------------------------------------------- |
| `mode`                  | `"preview"`      | `preview`, `auto`, or `off`; manual cleanup allowed in preview only after confirmation |
| `connectionKey`         | `"unconfigured"` | Unique namespace per server; must be changed before closure                            |
| `acknowledgeSharedTabs` | `false`          | Explicit acknowledgement required for any closure                                      |
| `idleMinutes`           | `30`             | Minimum time since qualifying activity; 0 permits immediate eligibility after grace    |
| `graceMinutes`          | `30`             | Minimum grace after observation begins or a protection clears                          |
| `excluded`              | `false`          | Exclude all tabs by default; rules can opt selected matches back in                    |
| `checkSeconds`          | `30`             | Scheduler interval; integer 5–3600                                                     |
| `minTabs`               | `3`              | Hard retained-tab floor, counting protected tabs                                       |
| `softMaxTabs`           | `8`              | Target for `over-limit` cleanup; never overrides protections or timers                 |
| `cleanup`               | `"over-limit"`   | Close eligible idle tabs down to the soft maximum, or `all-idle` down to the floor     |
| `order`                 | `"oldest-idle"`  | `oldest-idle`, `oldest-opened`, `left-to-right`, `right-to-left`                       |
| `batchSize`             | `2`              | Maximum closes per manual/automatic pass; integer 1–100                                |
| `batchDelaySeconds`     | `2`              | Delay between closes, also minimum gap after the last successful automatic batch       |
| `notification`          | `"summary"`      | One summary toast per successful batch, or `silent`                                    |

For `over-limit`, `softMaxTabs` is required and must be at least `minTabs`. In `all-idle` mode the soft maximum does not limit cleanup. A floor of zero still cannot override selected/running protections. Protected tabs may exceed the soft maximum indefinitely.

Refresh controls:

| Option                      | Default | Meaning                                                                                                                     |
| --------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| `refreshTimeoutSeconds`     | `15`    | Entire refresh-pass deadline, 1–120 seconds; individual roots receive a bounded share                                       |
| `storageTimeoutSeconds`     | `10`    | Maximum wait for any durable state update, 1–120 seconds; failures/timeouts disable further writes and cleanup until reload |
| `verificationMaxAgeSeconds` | `5`     | Maximum final verification window, 1–120 seconds, measured after intent persistence and checked immediately before closing  |
| `refreshConcurrency`        | `3`     | Concurrent root families, 1–8; descendants remain bounded to 256                                                            |
| `previewRefreshSeconds`     | `300`   | Background preview refresh interval, 30–3600 seconds; opening the inspector refreshes immediately                           |

Failed, timed-out, and unvisited roots remain unknown/protected. Completed roots can remain usable when another root stalls. Bulk passes rotate their starting point to avoid starvation. Each actual candidate receives its own fresh read, including a fresh active-execution snapshot, before intent persistence and the final local recheck. Shared OpenCode caches are not invalidated by Wrangler.

Candidates are reverified **again after** intent persistence. Slow or failed final verification never authorizes a close. The final window includes the verification request and local decision work, not just time since a response. Candidate-specific activity fences prevent a busy unrelated tab from repeatedly cancelling quiet-tab cleanup; layout/configuration changes remain conservative global fences.

### Independent protections

Every flag defaults to `true`:

```json
{
  "protections": {
    "unreadActivity": true,
    "unreadErrors": true,
    "questions": true,
    "permissions": true,
    "pending": true,
    "attention": true
  }
}
```

`attention` is the native aggregate waiting indicator. **To allow closing question- or permission-waiting tabs, disable both the corresponding flag and `attention`** for that policy. This deliberate overlap prevents an unknown attention subtype from being silently treated as idle. Disabling protections is advanced behavior and the UI requests confirmation.

Pending means queued execution/control inbox work, not parked synthetic context. Running work, local selection, unknown state, and unknown busy signals cannot be opted out of. Root tabs protect running/waiting descendants, even if the child has a different directory. Families over 256 sessions fail closed rather than performing unbounded scans.

### Which activity resets the timer?

```json
{
  "activity": {
    "selection": true,
    "sessionUpdates": true,
    "backgroundEvents": true
  }
}
```

- `selection`: viewing a tab refreshes its last-use time.
- `sessionUpdates`: newer family metadata timestamps refresh last use.
- `backgroundEvents`: message-content, execution, inbox, permission, and form events refresh last use. Metadata refreshes alone are not these events.

The closure deadline is the **later** of last activity + idle interval and last grace reset + grace interval. A selected or protected tab cannot become eligible; clearing a protection starts fresh idle and grace intervals, even with optional activity sources disabled.

Startup, reload, reopening, resume, re-enabling native tabs, observation gaps, clock rollback, and configuration changes grant fresh grace. Time spent while the plugin is absent is not counted. A restored tab cannot immediately disappear into an auto-close loop. Pause is local to a TUI, survives plugin reload, and ends when that TUI exits.

Selection activity is recorded even while refresh is in progress. Deliberate batch waits are not mistaken for machine sleep. Runtime observations are bounded to currently open tabs; memory checkpoints are coalesced and flushed on orderly plugin unload.

Gap detection runs for manual cleanup and observation/refresh paths as well as scheduled ticks. Intentional waits permit their configured duration, but oversleep or clock rollback grants fresh grace before further closures. Meaningful running/waiting/unread protection transitions are remembered during cleanup even when optional activity sources are off; private verification hydration alone is not treated as new activity.

### Ordered project/title rules

Rules override `idleMinutes`, `graceMinutes`, `excluded`, nested `protections`, and nested `activity`. Match properties are ANDed; omitted properties are unrestricted. An empty match applies to everything. All enabled matching rules apply in order; later values win. `stop: true` ends evaluation after that match.

```json
{
  "rules": [
    {
      "name": "Keep production projects",
      "match": { "directory": "*/production/*" },
      "set": { "excluded": true },
      "stop": true
    },
    {
      "name": "Long-lived research",
      "match": { "title": "*research*" },
      "set": { "idleMinutes": 180, "graceMinutes": 60 }
    },
    {
      "name": "Short-lived scratch work",
      "match": { "directory": "*/scratch/*", "title": "*experiment*" },
      "set": {
        "idleMinutes": 10,
        "graceMinutes": 10,
        "protections": { "unreadActivity": false }
      }
    }
  ]
}
```

Match keys: `directory` (session directory), `title`, `project` (project ID, not display name), `session` (session ID), and `caseSensitive` (default false). Wildcards: `*` matches any sequence, including path separators; `?` matches one Unicode code point. Other characters are literal. No globstar/regex syntax. Use actual absolute paths, not `~` or environment substitutions inside patterns. Disable a rule with `enabled: false`. Settings offers guided rule creation, enable/disable, move earlier/later, duplication, deletion, single-rule JSON, and whole-array JSON. Up to 200 rules. Oversized identity metadata (titles/directories over 4096 UTF-16 units or IDs over 512) protects the tab instead of running unbounded matching.

### Schedule

```json
{
  "schedule": { "days": [1, 2, 3, 4, 5], "startHour": 9, "endHour": 18 }
}
```

Terminal machine's local time; Sunday is 0. Default: all days, 0–24. End hour is exclusive. Overnight windows such as 22–6 belong to the weekday on which the window starts. Empty days or equal start/end disable cleanup for that schedule. Scheduling applies to manual cleanup too, but not restoration.

### Corral privacy and retention

```json
{
  "history": { "maxEntries": 200, "days": 30, "rememberTitles": true }
}
```

Durable storage contains preferences, session locks, and bounded recovery metadata (IDs, title if enabled, directory, project ID, original position, timestamps, outcome). It contains **no transcript, drafts, questions, answers, permission details, or credentials**. Titles and paths are private local metadata; turn off `rememberTitles` to omit and scrub stored titles at the next persistence/prune. Entries are capped/expired across all namespaces, not separately per connection.

An `intent` is written **before** closing. Failed persistence prevents closure. Unfinished intents become `uncertain` on reload, never automatically replayed. Explicitly inspect, restore, or forget uncertain entries. The no-retry protection lasts while the uncertain entry is retained; expiry, clearing, or forgetting removes that record. Manual closure outside Wrangler is not added to the durable corral (OpenCode has its own reopen-last-closed behavior).

A storage failure or timeout stops further writes/cleanup in that plugin instance. A timeout does **not** prove that an admitted disk operation was cancelled: it may commit late. Late callbacks cannot authorize a close; an already-admitted late write may leave an intent to inspect after recovery. Resolve storage availability, reload, and inspect the corral before resuming. No automatic retry is made. Restoration remains available, but forgetting the restored entry can fail while storage is unavailable.

Housekeeping physically prunes expired durable entries and expired locks on the next available scheduler check (at most once per minute under frequent checks). It also runs while paused or off. Logical history reads hide expired entries immediately; the plugin does not promise deletion while OpenCode is stopped or storage is unavailable. Permanent locks intentionally persist until explicitly unlocked.

## Complete automatic-cleanup example

Merge this plugin entry into `cli.json` only after reviewing the shared-tab limitation:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-tab-wrangler",
      "options": {
        "mode": "auto",
        "connectionKey": "local-main",
        "acknowledgeSharedTabs": true,
        "idleMinutes": 45,
        "graceMinutes": 15,
        "minTabs": 4,
        "softMaxTabs": 12,
        "cleanup": "over-limit",
        "batchSize": 2,
        "order": "oldest-idle",
        "history": { "maxEntries": 500, "days": 60 },
        "rules": [
          {
            "name": "Keep important sessions",
            "match": { "title": "*important*" },
            "set": { "excluded": true },
            "stop": true
          }
        ]
      }
    }
  ]
}
```

## Development and verification

Linux x64, Bun 1.4.0, OpenCode 2.1.4; OpenTUI 0.6.8 and patched Solid 1.9.17 for development. Host APIs are isolated in `src/host.ts`; pure policy is in `src/policy.ts`. Refresh is bounded to open tabs and descendants, with configurable concurrency/deadlines. There are no transcript downloads or scans of all historical sessions.

OpenCode owns its bundled UI runtime. Installing this plugin's patched Solid peer does not upgrade the host's bundled libraries; package audits are not a security certification of OpenCode. The SDK and OpenTUI are development-only here, avoiding their development peer pin in production consumers. Standalone/manual shell side-channels are not session executions and are not advertised as tracked by the session-execution guard.

```sh
bun install --frozen-lockfile
bun run check
bun run test:coverage
bun run test:live
bun run test:package
bun run schema
bun pm pack
```

Tests cover policy, configuration precedence, wildcard rules, family aggregation, storage failures, local races, clock/pause/reload grace, uncertain outcomes, restore, UI workflows, and package contracts. The explicit live test verifies real automatic closure, selected/question protection, session preservation, and restoration with disposable sessions and no model prompts. The package test repeats it outside the checkout with production dependencies only. Coverage only describes files exercised by tests; it is not proof of complete host compatibility.

Additional regressions cover conflicting native/server unread indicators (positive error evidence wins), slow/late storage outcomes, post-persistence verification, unrelated-tab activity, inverse-order batch recovery, and bounded wildcard/cache churn. The live test also checks pending permission protection and that parked synthetic context does not prevent cleanup. Wildcards use bit-parallel matching with bounded caches; configuration and cached policies are immutable.

The installed-package matrix also exercises real queued child work (`resume: false`, never executed), unsent text/image recovery, reload/restart/disconnection grace, disabled/global/cwd tabs, and two competing terminals. It deliberately does not claim other-client selection protection, atomic conditional close, or draft persistence after exit. A separately authorized loopback-only fixture proved genuine running-descendant protection and completion/recovery; its reviewed record is runtime-bound in `test/evidence/running-descendants.json`. CI's setup-only check does not itself pass that gate. See [native acceptance details](DEVELOPMENT.md).

CI runs installed-package/live tests, TypeScript and Python linting, schema parity, dependency/credential checks, and full-production-module coverage accounting. Coverage floors are 80% lines/75% functions per production file and 85% aggregate; tests/helpers are not part of the custom production denominator. Property and race tests supplement coverage, not the reverse. Public CI includes CodeQL; required checks and high/critical CodeQL merge restrictions protect the canonical repository's `main` branch.

Release verification installs the exact registry version, binds its lockfile integrity and installed files to the tested archive, and checks registry signatures/provenance for the package itself as well as dependencies. Version tags cannot be moved/deleted, and release publication requires maintainer approval. This is single-maintainer authorization, not a claim of independent two-person review. See [release operations](RELEASING.md).

Fresh stable releases publish the tested archive directly with `npm publish --tag latest` through the configured trusted publisher; RCs use `next`. Post-publication checks are read-only and gate GitHub finalization. Normal releases do not retag existing npm versions or require separate dist-tag-management permission.

See [Contributing](CONTRIBUTING.md), [Security](SECURITY.md), [Code of conduct](CODE_OF_CONDUCT.md), [Changelog](CHANGELOG.md), and [Releasing](RELEASING.md). Explicit version-tag releases publish through OIDC only after verification and approval. Automation never changes repository visibility. Dependency-update configurations are supplied; Renovate still requires its GitHub app to be authorized.

See [`DEVELOPMENT.md`](DEVELOPMENT.md) for the live smoke test, known limits, and release checklist. To disable, remove the CLI plugin entry or set mode `off`; no database cleanup or session deletion is necessary. Removing the entry does not erase the host's stored plugin preferences/history.
