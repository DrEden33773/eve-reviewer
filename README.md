# Eve Reviewer

Eve Reviewer (`eve-reviewer`) is an evidence-grounded TypeScript reviewer for pull-request changes. It owns review-domain behavior such as diff and source consistency, analyzer coverage, side-aware evidence, findings, reports, feedback and evaluation.

The product will remain independently testable and runnable through a headless CLI while also shipping as a trusted first-party Adam Agent extension. Adam will provide extension lifecycle, bounded operations, provider-managed Agent sessions, effect authorization, durable host services and TUI/Web shells; Eve will not build a second general Agent platform or standalone application shell.

## Current status

The current implementation provides a deterministic local review path with normalized old/new-side changes, explicit base/head source availability, source-owned evidence and per-file coverage.

The current path is intentionally narrow:

- it recognizes one JavaScript/TypeScript dynamic-code-evaluation rule through pinned Biome;
- it classifies added, modified, deleted, renamed, binary and metadata-only files;
- it can validate old- or new-side findings through the exported core use case, while the current Biome Adapter emits new-side findings only;
- it reports `complete`, `partial` or `no-coverage` from explicit per-file analysis and source availability;
- its Biome execution and local source loading are still synchronous and do not accept caller cancellation or deadlines; and
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

The source root supplies the post-change head files needed by the current syntax-aware analyzer. The report distinguishes analyzed files from unsupported, deleted, binary, metadata-only or unavailable content. Output from this command is deterministic fixture evidence, not a claim of production readiness. Diff-only syntax-aware review remains unsupported.

Making analyzer execution asynchronous, cancellable and deadline-aware requires a separately authorized behavior slice. Publication also requires separate authorization.

Third-party parser and analyzer dependencies are recorded in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

See [`AGENTS.md`](AGENTS.md) for the authoritative engineering contract.
