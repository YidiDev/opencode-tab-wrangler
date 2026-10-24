# Security policy

## Supported preview

The preview supports **OpenCode 2.1.4**, tested on Linux x64 with Bun 1.4.0. Other versions are disabled, not implicitly supported. There is no response SLA or production certification.

## Report privately

Use [GitHub private vulnerability reporting](https://github.com/YidiDev/opencode-tab-wrangler/security/advisories/new). Never post vulnerabilities, credentials, transcripts, or exploitable reproduction details in public issues or PRs.

If that route is unavailable, request a private contact channel from [@YidiDev](https://github.com/YidiDev) with a minimal issue titled **Private security contact requested**, containing no vulnerability details. The maintainer can arrange a private channel. Private vulnerability reporting must be enabled before making this repository public.

Include affected versions, impact, and a sanitized reproduction using disposable fixtures. Do not send authorization headers or complete diagnostic archives.

## Boundaries

- Tabs are removed, not sessions; requests are never approved or answered.
- Other terminals' selected tabs are not visible. No atomic conditional-close API exists; unseen server-event races cannot be eliminated.
- Local recovery metadata includes IDs, paths, and optionally titles. It is not encrypted by this plugin and is not a transcript/draft backup.
- `connectionKey` is a manual namespace, not authenticated server identity.
- Uncertain results are not retried while retained. Forgetting, clearing, and expiry remove that protection.

## Dependencies

`bun run test:security` scans tracked/unignored project files for common credential patterns without printing matches, then runs `bun audit`. The scanner is not a substitute for GitHub secret scanning or manual review. CI fails on known advisories; there are currently no vulnerability suppressions.

The initial Solid 1.9.15 graph pulled vulnerable Seroval 1.5.6. Development Solid is now 1.9.17 (patched Seroval 1.6.8), and patched Solid peers are required. Advisories: GHSA-p6vx-979v-rg4c and GHSA-jp82-f5mq-hwhp. Reachability through this plugin was not demonstrated. OpenCode must maintain its own host-owned runtime: a peer declaration cannot patch an already-running host.
