# Eve Review Agent

Eve Review Agent is an evidence-grounded TypeScript agent for reviewing pull requests, explaining findings, and proposing safe fixes.

The first runnable slice provides a deterministic local review path for a representative unified diff. It validates that every finding references an added line and emits a normalized JSON report. HTTP, persistence, model providers, GitHub integration, and the dashboard are not implemented yet.

## Development

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm hooks:install
pnpm quality:check
```

Use `pnpm quality:fix` only when an intentional formatting rewrite is desired. The pre-commit hook is check-only.

## Deterministic local review

Run the committed fixture through the one-shot CLI:

```bash
pnpm review:fixture
```

For another unified diff, call the CLI with an explicit repository and pull-request number:

```bash
node apps/cli/src/main.ts --repository owner/repository --pull-request 123 --source-root path/to/post-change-tree path/to/change.diff
```

The source root must contain the complete post-change files referenced by the diff. This deterministic path currently recognizes one JavaScript and TypeScript dynamic-code-evaluation rule. Its output is fixture evidence, not a claim of complete review coverage or production readiness; diff-only syntax-aware review is not supported.

Third-party parser and analyzer dependencies are recorded in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

See [`AGENTS.md`](AGENTS.md) for the authoritative engineering contract.
