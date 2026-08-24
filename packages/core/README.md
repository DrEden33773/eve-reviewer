# `@eve-reviewer/core`

Validated request and result contracts plus the deterministic review use case used by Eve Reviewer adapters.

## Runtime

- Node.js 24
- ESM

## Public API

The package exposes one root entry. Use `reviewContractV1` with `createReviewUseCase()` for the preserved pull-request path. Use `localReviewContractV1` with `createLocalReviewUseCase()` for a captured local worktree whose subject records the exact Git object format, base commit/tree or unborn tree, candidate tree and Adam snapshot digest. Both use cases run through caller-supplied analyzer boundaries and emit the same strict version-1 review-result contract.

```ts
import {
  createLocalReviewUseCase,
  createReviewUseCase,
  localReviewContractV1,
  reviewContractV1,
} from "@eve-reviewer/core";
```

See the repository documentation for the complete contract and architecture.

## License

Apache-2.0
