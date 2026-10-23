## What and why

Describe the user-visible improvement and link the issue, if any.

## Safety and compatibility

- [ ] No session deletion, archival, interruption, generation, or approval APIs introduced
- [ ] Unknown/ambiguous state remains fail-closed
- [ ] Manual confirmation cannot expand to unapproved session IDs
- [ ] Locally selected/running tabs remain protected
- [ ] Host compatibility changes have explicit live evidence

## Verification

- [ ] `bun run check`
- [ ] `bun run lint:python` (when Python changes)
- [ ] `bun run test:coverage`
- [ ] `bun run test:security`
- [ ] `bun run test:package` (entrypoints, packaging, host adapter, lifecycle changes)
- [ ] Regression tests and user documentation updated

Include sanitized results only. Do not attach transcripts, credentials, or raw server logs.
