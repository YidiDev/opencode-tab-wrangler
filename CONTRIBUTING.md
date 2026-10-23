# Contributing

This preview CLI plugin is maintained by [@YidiDev](https://github.com/YidiDev). Focused contributions with reproducible tests are welcome. Discuss architecture changes or new dependencies in an issue first.

## Setup and verification

Use Linux x64, Bun **1.4.0**, Python **3.12**, and OpenCode **2.1.4**. Do not widen compatibility based only on a typecheck.

```sh
bun install --frozen-lockfile
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
bun run check
.venv/bin/python -m ruff check tools
.venv/bin/python -m ruff format --check tools
bun run test:coverage
bun run test:security
```

Run `bun run schema` after schema changes and commit `schema.json`. Format TypeScript/docs with `bun run format`; format Python with `.venv/bin/python -m ruff format tools`.

Adapter, lifecycle, packaging, or host compatibility changes also require `bun run test:live` and `bun run test:package`. They create disposable sessions in isolated directories, never submit a model prompt, and must never target your normal OpenCode service. See `DEVELOPMENT.md` for remaining compatibility limits.

## Expectations

- Follow `AGENTS.md`: pure policy, host access isolated in `src/host.ts`.
- Never introduce session deletion, archival, interruption, generation, question-answer, or permission-approval calls.
- Fail closed on missing data, deadlines, stale generations, persistence failure, and ambiguous effects.
- Bind manual confirmation to explicit IDs; recheck before effects.
- Add regression tests for bugs and update user-facing documentation.
- Test counts and aggregate coverage do not replace behavioral assertions.
- Never commit real transcripts, credentials, private paths, `.artifacts`, or archives.

Open a pull request against `main` and complete its checklist. CI checks static quality, production coverage, dependency/credential scanning, and installed-package behavior. Safety-sensitive changes require maintainer review. Dependencies are not automatically merged.

Contributions use the MIT license. Follow `CODE_OF_CONDUCT.md`; report vulnerabilities using `SECURITY.md` rather than public bug reports.
