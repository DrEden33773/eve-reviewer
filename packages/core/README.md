# `@eve-reviewer/core`

Validated request and result contracts plus the deterministic and managed-model review composition used by Eve Reviewer adapters.

## Runtime

- Node.js 24
- ESM

## Public API

The package exposes one root entry. Use `reviewContractV1` with `createReviewUseCase()` for the preserved pull-request path. Use `localReviewContractV1` with `createLocalReviewUseCase()` for a captured local worktree whose subject records the exact Git object format, base commit/tree or unborn tree, candidate tree and Adam snapshot digest. `modelReviewCandidatesCodec` validates the strict `eve-reviewer.model-review-candidates@1` envelope; `createModelReviewOutcome()` validates the managed-review receipt and its exact output contract, SHA-256 digest and UTF-8 byte count, attaches the code-owned recipe, extracts changed-line evidence from immutable sources and returns an ordinary analyzer outcome for the existing use case. Both use cases emit the same strict version-1 review-result contract.

```ts
import {
  createLocalReviewUseCase,
  createModelReviewOutcome,
  createReviewUseCase,
  localReviewContractV1,
  modelReviewCandidatesCodec,
  reviewContractV1,
} from "@eve-reviewer/core";
```

See the repository documentation for the complete contract and architecture.

## License

Apache-2.0

## Managed-review receipt

Core 0.4.0 accepts `reviewRunId`, `policyDigest`, resolved `target`, `evidenceSetDigest`, `output`, `traceDigest` and `usage` through `ModelReviewRunProvenance`. The receipt accompanies the decoded candidate envelope; its output contract must be `eve-reviewer.model-review-candidates@1` and its digest and byte count must match the JSON serialization of that envelope. Candidate output is bounded to one MiB. Core validates side-aware changed-line evidence before producing findings.

The receipt is supplied by the trusted host through the adapter. Core checks structure and output consistency; a self-consistent receipt alone does not authenticate a host or prove model execution. Host target selection, routing policy and execution budgets remain host-owned. Core imposes no cumulative token or turn ceiling and accepts no legacy agent/attempt identity, transcript record or cost placeholder. Older stored reports remain accessible through their existing versioned report contracts.
