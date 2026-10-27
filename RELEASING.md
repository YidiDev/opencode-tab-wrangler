# Releasing OpenCode Tab Wrangler

Author and maintainer: **Yidi Sprei (YidiDev)**. npm owner: **yididev**.
No automation changes local users' OpenCode settings. Releases have no calendar restriction.

## Version contract

Use `1.0.0-rc.N` for candidates (`next`) and `1.0.0` for stable (publish directly to `latest` after pre-publication verification).
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
   restricted to version tags. The separate approval job gates the tested archive's publication once.
6. The locally authenticated `yididev` account reserved the unscoped name through npm staging.
   The staged rc.1 was a reservation artifact: leave it unapproved and reject it through the
   owner's interactive account flow. RC2 was published from its verified tagged archive through
   OIDC; do not approve the older draft or restore the unusable placeholder tag.
7. Configure npm trusted publishing for GitHub owner `YidiDev`, repo `opencode-tab-wrangler`,
   workflow **release.yml**, environment **npm**. Allow direct publishing. Fresh publication with
   `npm publish --tag latest` assigns the tag as part of publishing and does not require separate
   dist-tag-management permission. That additional permission is relevant only to explicitly
   retagging an already-published version during owner-directed recovery, not normal releases.
   Use `npm trust` if supported by the authenticated account or npm's package settings.
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
   stable versions directly to `latest`, using the configured trusted publisher and explicit provenance. There is no automated retagging job or `candidate` staging tag. Project dependency/build code never runs in the publisher.
6. A separate read-only job verifies registry bytes and the expected `latest`/`next` tag, installs the exact registry version with strict npm peer resolution (not a file: install, which npm's signature verifier skips),
   runs isolated live tests, and tests OpenCode's actual exact-version npm plugin resolver.
7. Only after post-publication registry acceptance passes is the GitHub release finalized: a draft receives all assets, then becomes immutable. npm's stable version is already public on `latest` at this point; a later failed smoke test does not undo publication. Inspect and recover explicitly rather than republish or silently retag.

RCs are published with `--tag next`, never deliberately to latest. The first real publication over npm's reservation placeholder nevertheless assigned latest to RC2; npm rejected authenticated deletion with HTTP 400. The owner accepted this bootstrap caveat. Until stable is ready, use the exact RC version or `@next`; do not restore the unusable placeholder or bypass readiness gates.

Stable 1.0.0 is machine-blocked by `release-readiness.json` until the broader live compatibility matrix in DEVELOPMENT.md has
evidence, including native unread/errors, executable queues, running descendants, drafts/
attachments, reload/disconnection, tab scopes and competing clients. Public RCs remain clearly
labelled prereleases; no claim of cross-terminal selected-tab safety is made.

The production-only package test runs the nine native acceptance scenarios described in DEVELOPMENT.md. Running evidence must come from a genuine isolated execution: an owner can run `bun run test:running:owner` and press Enter, or an explicitly owner-authorized local agent can use `python3 tools/manual-running.py --authorized-agent` under the AGENTS.md exception. Both use only the deterministic loopback dummy provider, not external models, real credentials, paid services, or real user sessions. Evidence distinguishes a human submission from an owner-authorized agent run; never label one as the other. CI continues to use only `--setup-only`, requires zero inference requests, and cannot count that setup as passing running evidence.

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
After a successful publish response, missing version/tag visibility receives at most 12 read-only verification attempts with five-second intervals (each request also has its own timeout). Integrity mismatches and other errors stop immediately. These reads never repeat `npm publish` or run `npm dist-tag`. If visibility remains uncertain, inspect the registry before an owner resumes the failed run; an already-visible matching version is verified, not republished. If its tag differs, stop for explicit owner recovery instead of silently retagging it.

Registry/network ambiguity never triggers an automatic publish retry. A failed registry smoke prevents GitHub finalization, but cannot undo an admitted npm publication. Before fresh stable publication, the workflow refuses to downgrade an existing newer latest or replace an unknown current version; a recognized RC at the same or lower base version is allowed. A partially uploaded draft requires inspection; assets are never clobbered.

If a stable release is faulty, an authenticated owner can move latest to a previously verified
version, deprecate the faulty version, and publish a patch. OIDC does not authorize npm deprecate;
use the owner's supported interactive/2FA flow. Automated publication refuses downgrades.
Do not automatically unpublish, delete releases/tags, or erase audit evidence.
