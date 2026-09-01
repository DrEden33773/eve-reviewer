# `@eve-reviewer/core`

Validated request and result contracts plus the deterministic and managed-model review composition used by Eve Reviewer adapters.

## Runtime

- Node.js 24
- ESM

## Public API

The package exposes one root entry. Use `reviewContractV1` with `createReviewUseCase()` for the preserved pull-request path. Use `localReviewContractV1` with `createLocalReviewUseCase()` for a captured local worktree whose subject records the exact Git object format, base commit/tree or unborn tree, candidate tree and Adam snapshot digest. `modelReviewCandidatesCodec` validates the strict `eve-reviewer.model-review-candidates@1` envelope; `createModelReviewOutcome()` attaches code-owned recipe and host-neutral run provenance, extracts changed-line evidence from immutable sources and returns an ordinary analyzer outcome for the existing use case. Both use cases emit the same strict version-1 review-result contract.

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
