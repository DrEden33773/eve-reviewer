# Eve Reviewer

Eve Reviewer (`eve-reviewer`) is an evidence-grounded TypeScript reviewer for pull-request changes. It owns review-domain behavior such as diff and source consistency, analyzer coverage, side-aware evidence, findings, reports, feedback and evaluation.

The product will remain independently testable and runnable through a headless CLI while also shipping as a trusted first-party Adam Agent extension. Adam will provide extension lifecycle, bounded operations, provider-managed Agent sessions, effect authorization, durable host services and TUI/Web shells; Eve will not build a second general Agent platform or standalone application shell.

## Current status

The current implementation provides a strict versioned domain contract and an asynchronous deterministic local review path with normalized old/new-side changes, explicit base/head source availability, source-owned evidence and per-analyzer file coverage.

The current path is intentionally narrow:

- it recognizes one JavaScript/TypeScript dynamic-code-evaluation rule through pinned Biome;
- it classifies added, modified, deleted, renamed, binary and metadata-only files;
- it can validate old- or new-side findings through the exported core use case, while the current Biome Adapter emits new-side findings only;
- it reports `complete`, `partial` or `no-coverage` from a stable per-file analysis matrix and source availability;
- its strict v1 request, analyzer-outcome and result envelopes reject unknown fields, unsupported schema versions and untrusted analyzer output with bounded typed errors;
- its exported headless review use case accepts an absolute deadline, cancellation signal and caller-tightened resource limits, preserves duplicate findings and recomputes report truth from validated outcomes;
- its exported stateless in-memory JSON Adapter decodes a request and returns canonical compact JSON without retaining review state;
- its Linux CLI Adapter runs pinned Biome asynchronously with bounded source, stdout, stderr and SARIF bytes, process-group termination and temporary-resource cleanup;
- its strict deterministic evaluation package replays versioned synthetic cases through frozen and current review targets, compares protected coverage exactly, matches findings as an evidence-linked multiset and emits bounded integer metrics from a canonical one-shot command; and
- its trusted Adam extension Adapter registers `eve-reviewer.review@1`, calls Adam's fixed Biome capability, publishes the canonical Eve result artifact, creates an immutable operation record and returns only bounded terminal references.

The source tree contains release-ready `@eve-reviewer/core@0.1.0` and `@eve-reviewer/adam-extension@0.1.0` package manifests. Registry publication is a separate release action; source availability does not imply that either package is already published.

HTTP, an Eve-owned provider/runtime, queues, databases and a standalone dashboard are not planned for the first integrated path.

## Development

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm hooks:install
pnpm quality:check
```

Use `pnpm quality:fix` only when an intentional formatting rewrite is desired. The pre-commit hook is check-only.

`pnpm build` emits unbundled Node.js 24 ESM and declarations into each public package's ignored `dist/` directory. The core package exposes one root entry. The Adam extension exposes one root entry with named `activate()` and exact compatibility with `@adam-agent/extension-api@0.1.0` and `@eve-reviewer/core@0.1.0`.

## Deterministic local review

Run the committed fixture through the one-shot CLI:

```bash
pnpm review:fixture
```

For another unified diff, call the current CLI entry with an explicit repository and pull-request number. The package executable identity is `eve-reviewer`:

```bash
pnpm exec eve-reviewer --repository owner/repository --pull-request 123 --source-root path/to/post-change-tree path/to/change.diff
```

The source root supplies the post-change head files needed by the current syntax-aware analyzer. The command writes one canonical v1 result envelope: success goes to stdout, while domain or Adapter failures go to stderr. Its coverage matrix distinguishes analyzed files from unsupported, deleted, binary, metadata-only or unavailable content and records the exact analyzer profile used. `SIGINT` and `SIGTERM` cancel an active CLI review and wait for bounded analyzer cleanup. Output from this command is deterministic fixture evidence, not a claim of production readiness. Diff-only syntax-aware review remains unsupported.

## Deterministic evaluation

Replay the checked-in versioned synthetic cases against the frozen baseline and the current exported review use case:

```bash
pnpm evaluation:compare
```

The command accepts no arguments and never promotes or rewrites a baseline. A completed comparison is written as one canonical v1 evaluation-result envelope on stdout: exit code `0` means the candidate passed every protected fact, while exit code `1` means a completed gate failed. Invalid data, resource limits, cancellation or deadline expiry use a typed terminal envelope on stderr and exit code `1`; usage errors exit with code `2`. The checked-in cases protect old/new-side evidence, source availability, modified/deleted file classification and `complete`, `partial` and `no-coverage` states. They are controlled synthetic evidence, not live-provider, production or model-quality evidence.

Third-party parser and analyzer dependencies are recorded in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

See [`AGENTS.md`](AGENTS.md) for the authoritative engineering contract.
