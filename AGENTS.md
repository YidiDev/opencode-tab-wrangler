# Repository guidance

- Standalone CLI-only plugin for OpenCode 2.1.4 and newer; no dependency on agent-communicator. Newer versions are live-eligible unless an incompatibility is demonstrated; preserve fail-closed state checks and document tested versions separately.
- Use Bun 1.4.0. Run `bun run check`, `bun run schema`, and `bun pm pack` for release changes.
- Keep policy pure and host access in `src/host.ts`. Never call session deletion, archival, interruption, generation, question answers, or permission approvals.
- Exception for isolated execution tests: agents may run tests using the local dummy provider, with no external model calls, API keys, paid calls, or real user sessions. Production plugin code must never initiate generation. This exception does not permit session deletion, archival, interruption, question answers, or permission approvals.
- Unknown state must protect tabs. Persist recovery intent before close. Recheck immediately before effects; ambiguous closes must not be silently retried.
- Preserve preview-first defaults, selected/running/unknown-state invariants, server namespace separation, and explicit shared-layout acknowledgement.
- Every behavior change needs tests and matching README updates. Do not alter the user's real OpenCode config or test with their sessions.
- No subagents are required. No unsafe host-internal APIs or broad filesystem access.
