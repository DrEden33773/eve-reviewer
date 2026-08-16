# `@eve-reviewer/core`

Validated request and result contracts plus the deterministic review use case used by Eve Reviewer adapters.

## Runtime

- Node.js 24
- ESM

## Public API

The package exposes one root entry. Use `reviewContractV1` to decode caller input and encode results, and `createReviewUseCase()` to run a review through a caller-supplied analyzer boundary.

```ts
import { createReviewUseCase, reviewContractV1 } from "@eve-reviewer/core";
```

See the repository documentation for the complete contract and architecture.

## License

Apache-2.0
