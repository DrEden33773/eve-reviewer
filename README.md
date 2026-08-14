# Eve Reviewer

Eve Reviewer (`eve-reviewer`) is an evidence-grounded TypeScript reviewer for pull-request changes. It owns review-domain behavior such as diff and source consistency, analyzer coverage, side-aware evidence, findings, reports, feedback and evaluation.

The product will remain independently testable and runnable through a headless CLI while also shipping as a trusted first-party Adam Agent extension. Adam will provide extension lifecycle, bounded operations, provider-managed Agent sessions, effect authorization, durable host services and TUI/Web shells; Eve will not build a second general Agent platform or standalone application shell.

## Current status

The first merged slice provides a deterministic local review path for one representative unified diff. It validates that every current finding references an added line and emits a normalized JSON report.

The current path is intentionally narrow:

- it recognizes one JavaScript/TypeScript dynamic-code-evaluation rule through pinned Biome;
- it requires complete post-change source for syntax-aware analysis;
- it does not yet model old-side evidence or truthful per-file analyzer coverage; and
- it has no Adam extension Adapter, model reviewer, persistence, GitHub integration, TUI or Web contribution.

HTTP, an Eve-owned provider/runtime, queues, databases and a standalone dashboard are not planned for the first integrated path.

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

For another unified diff, call the current CLI entry with an explicit repository and pull-request number. The package executable identity is `eve-reviewer`:

```bash
pnpm exec eve-reviewer --repository owner/repository --pull-request 123 --source-root path/to/post-change-tree path/to/change.diff
```

The source root must contain the complete post-change files referenced by the diff. Output from this command is deterministic fixture evidence, not a claim of complete review coverage or production readiness. Diff-only syntax-aware review is not supported by the current slice.

The next behavior work will first make diff/snapshot, old/new-side evidence and coverage semantics truthful, then make analyzer execution asynchronous and cancellable. Each behavior slice requires separate authorization and publication steps.

Third-party parser and analyzer dependencies are recorded in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

See [`AGENTS.md`](AGENTS.md) for the authoritative engineering contract.
