# Releasing OpenCode Tab Wrangler

Author and maintainer: **Yidi Sprei (YidiDev)**. npm owner: **yididev**.
No automation changes local users' OpenCode settings. Releases have no calendar restriction.

## Version contract

Use `1.0.0-rc.N` for candidates (`next`) and `1.0.0` for stable (`latest` after verification).
Patch releases preserve the documented configuration/commands/state contract. Minor releases
add compatible behavior or host support. Breaking settings/defaults/contracts or dropping
previously supported hosts require a major release. Storage schema version is independent.
Only OpenCode 2.1.4/Linux x64 is currently verified. Do not widen that claim without evidence.

v1 changes the public defaults: preview, idle/grace 30 minutes, minimum 3, soft maximum 8,
over-limit cleanup, oldest-idle, batch 2, delay 2 seconds, every protection enabled. Explicit
saved/file preferences still override defaults. Upgrading grants fresh grace. There is no
silent activation, shared-layout acknowledgement, or server-namespace assignment.

## One-time owner setup

1. Pass `bun run check`, `bun run test:coverage`, `bun run lint:python`,
   `bun run test:security`, full-history Gitleaks, and the isolated package test.
2. Audit licenses, privacy, tracked history, Actions artifacts, and public-facing metadata.
3. Make the source public only after those gates pass. Enable and verify private vulnerability
   reporting and appropriate secret scanning/push protection. Enable immutable releases.
4. Protect main with `quality`, `installed-package`, and `analyze`, plus PRs and no force pushes.
   A sole maintainer cannot provide independent review of their own PR: do not claim otherwise.
   Protect creation/update/deletion of version tags. Never rewrite published release history.
5. Configure environment **release-approval** with YidiDev as required reviewer (self-review
   allowed for this single-maintainer project). Configure **npm** with no additional reviewer,
   restricted to version tags. The separate approval job gates both publishing operations once.
6. The locally authenticated `yididev` account reserved the unscoped name through npm staging.
   Only npm's `0.0.0-stage` placeholder is public. The staged rc.1 was a reservation artifact:
   leave it unapproved and reject it through the owner's interactive account flow. Release
   rc.2 from the verified tagged archive through OIDC, rather than approving the older draft.
7. Configure npm trusted publishing for GitHub owner `YidiDev`, repo `opencode-tab-wrangler`,
   workflow **release.yml**, environment **npm**. Explicitly allow direct publishing and dist-tag
   management. Use `npm trust` if supported by the authenticated account or npm's package settings.
   Complete the first real OIDC publication within two days of configuring trust.
8. Prove automation with the first public RC before stable. Stable publishing requires
   provenance. After verifying OIDC, enable
   npm's “Require two-factor authentication and disallow tokens”. No npm token is stored in GitHub.

## Routine release

1. Open a release PR updating package version, lockfile, versioned changelog, compatibility
   evidence and notices. Do not add features during candidate stabilization.
2. Merge only after verification. Create an annotated tag matching package version exactly:
   `git tag -a v1.0.0-rc.2 -m 'Release v1.0.0-rc.2'`, then push that tag.
3. `release.yml` rejects forks/private sources, mismatched/moved tags, wrong versions and tags
   not reachable from main. It reruns quality, CodeQL and strict npm-consumer/live checks.
4. It publishes the exact tested archive, not a repack. A release manifest records SHA-256,
   npm SHA-512 integrity and source SHA. The runtime inventory describes tested external
   resolutions and licenses, not bundled third-party code or all future consumer resolutions.
5. Review the artifact and approve **release-approval**. GitHub OIDC publishes RCs to `next`,
   stable versions to `candidate`. Project dependency/build code never runs in the publisher.
6. A separate read-only job verifies registry bytes, installs the exact registry version with strict npm peer resolution (not a file: install, which npm's signature verifier skips),
   runs isolated live tests, and tests OpenCode's actual exact-version npm plugin resolver.
7. Only after those pass can OIDC explicitly promote a stable version to `latest`. The workflow never explicitly promotes an RC to latest. However, the first real publication over npm's reservation placeholder assigned latest to the RC despite `--tag next`; npm rejected authenticated deletion with HTTP 400. The owner accepted this bootstrap caveat. Until stable is ready, use the exact RC version or `@next` and do not interpret npm's latest tag as stable certification. Do not restore the unusable placeholder or bypass stable readiness gates.
   The GitHub release is created as a draft with all assets, then published immutable.

Stable 1.0.0 is machine-blocked by `release-readiness.json` until the broader live compatibility matrix in DEVELOPMENT.md has
evidence, including native unread/errors, executable queues, running descendants, drafts/
attachments, reload/disconnection, tab scopes and competing clients. Public RCs remain clearly
labelled prereleases; no claim of cross-terminal selected-tab safety is made.

The production-only package test runs the nine native acceptance scenarios described in DEVELOPMENT.md. The remaining real-running gate is owner initiated: run `bun run test:running:owner` in your own terminal, press Enter when the isolated fixture asks, and review its sanitized `evidence.json` and runtime hash. Agents/CI must only use `--setup-only`, which requires zero inference requests and cannot count as passing running evidence. Do not change the pending record or tag stable until the genuine owner-run result passes.

After review, commit only the sanitized passing record as `test/evidence/running-descendants.json` and update the readiness record. Stable release tooling checks its assertions and fingerprint against the current runtime source; changed runtime code requires a fresh owner-run result. Package version/documentation changes alone do not invalidate the runtime fingerprint. Never commit private session IDs, prompts, terminal logs, or authentication material.

## Recovery

There is no atomic transaction spanning npm and GitHub. Never overwrite a version or move a tag.
One release at a time: GitHub concurrency can replace pending runs, so it is not a FIFO queue.
Retry the existing tag with `gh workflow run release.yml --ref v1.0.0-rc.2 -f tag=v1.0.0-rc.2 -f resume_run_id=ORIGINAL_RUN_ID`.
The original verified artifact is retained for 30 days and reused, so dependency resolution
drift does not rewrite the release inventory. It is revalidated against the tag and its checksums.
If the artifact has expired, recover the original bytes/metadata from the release or inspect
the situation manually; never substitute new bytes for an already published version.
An existing identical npm version is verified and reused; different bytes stop the release.
After a successful publish response, metadata 404s receive at most 12 read-only verification attempts with five-second intervals (each request also has its own timeout). Integrity mismatches and other errors stop immediately. These reads never repeat `npm publish`. If visibility remains uncertain, inspect the registry before an owner resumes the failed run; an already-visible matching version is verified, not republished.

Registry/network ambiguity never triggers an automatic publish retry. A failed registry smoke prevents workflow promotion, but cannot undo npm's bootstrap tag assignment. Stable promotion can replace a recognized RC at the same or lower base version; it still rejects older stable targets, unknown current versions, and RC targets. A partially uploaded draft requires inspection; assets are never clobbered.

If a stable release is faulty, an authenticated owner can move latest to a previously verified
version, deprecate the faulty version, and publish a patch. OIDC does not authorize npm deprecate;
use the owner's supported interactive/2FA flow. Automated promotion refuses downgrades.
Do not automatically unpublish, delete releases/tags, or erase audit evidence.
