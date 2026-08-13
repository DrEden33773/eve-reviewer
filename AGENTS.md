# Engineering Instructions

## Product objective

Build a trustworthy, inspectable PR-review agent. Optimize for correct evidence-linked findings, bounded execution, safe GitHub effects, and a convincing end-to-end product before expanding the feature surface.

## Engineering rules

- Deliver working end-to-end slices and keep the current entry point runnable after every merged slice; once CLI or service entry points exist, do not regress them.
- Prefer the simplest complete design. Avoid speculative abstractions, configuration, indirection, and extension points.
- Add compatibility code or data migrations only for persisted data, public HTTP interfaces, and webhook contracts that require them.
- Separate review orchestration from GitHub, database, queue, model-provider, telemetry, and execution adapters.
- Prefer mature libraries after inspecting their current interfaces, types, licenses, and operational assumptions.
- Treat repositories, webhook payloads, diffs, model output, feedback, and dynamically loaded Skills as untrusted input.
- Fail closed on authorization. Keep model approval, user confirmation, authorization policy, and sandbox enforcement as separate controls.
- Do not claim production readiness or model improvement from synthetic evaluation data.
- Keep source provenance and third-party license notices at file or module level for reused or adapted code.
- Every behavior change and bug fix must include proportionate tests at a pre-agreed caller-visible seam.
- Linux is the only required platform until the first portfolio release is complete.

## Architecture boundaries

- The core review module owns task state, planning, reviewer scheduling, evidence validation, arbitration, report semantics, feedback, and evaluation policy.
- HTTP and webhook routes translate external requests to use cases; they do not contain review logic.
- Database, queue, GitHub, provider, telemetry, and Skill execution are adapters behind narrow ports.
- Do not add a general Agent SDK to the core review loop. Direct model clients and MCP adapters are acceptable at external seams.
- Do not create microservices, interfaces for one-off helpers, or generic plugin systems before two real implementations require them.
- Hash only external identity or integrity seams. Do not add hash chains or content hashes to ordinary internal state.

## Security and truthfulness

- Repository authorization is default-deny. Missing configuration never grants access.
- Never execute model-generated commands without an administrator or repository allow-list and an isolated effect seam.
- Never expose credentials to the browser, logs, model context, Skill processes, or error payloads.
- Never store browser bearer tokens in `localStorage`.
- Label synthetic evaluation as synthetic and keep it distinct from live-provider or production evidence.
- Auto-fix uses a new branch or patch artifact and never writes directly to the source branch.

## Data and concurrency

- Persist externally visible state transitions and checkpoint only at idempotent stage boundaries.
- In database-backed adapters, enforce idempotency with database constraints for webhook deliveries, task creation, report publication, and feedback consumption.
- Run the same repository contract suite against every claimed database adapter before claiming parity.
- Every asynchronous operation accepts cancellation, a deadline, and a bounded attempt policy.
- Use mature queue behavior instead of rebuilding leases, retries, or dead-letter handling without a measured reason.

## Frontend

- Use TypeScript, React, and Vite for the review workspace on the shared Node.js and pnpm baseline. Add component dependencies only when a working frontend slice reaches them.
- Keep server state in a query/cache layer and ephemeral view state local; do not duplicate the backend state machine in a global client store.
- Build custom diff and evidence views where generic UI primitives do not fit.
- Require visible keyboard focus, non-color severity cues, and finding-to-line navigation.
- Add a second server or BFF only for a documented deployment or server-rendering requirement.

## Testing and toolchain

- Before writing a behavior test, name the public interface and observable result under test. Work one failing behavior test and the minimum implementation to pass it at a time.
- Do not pre-write a horizontal test suite, inspect private state, or mock Eve-owned planners, reviewers, verifiers, arbiters, or report builders. Fake only external providers, clocks, GitHub, queues, processes, and filesystems at their real seams.
- Characterization fixtures freeze selected public behavior; they do not canonize known defects.
- Prefer deterministic fake provider streams in CI and keep live-provider tests opt-in.
- Run focused tests while iterating, then the complete Linux check once before merge.
- Start with one Linux workflow and add service-backed or browser jobs only when the corresponding adapter exists.
- A clean test run does not prove live GitHub, provider, deployment, or security behavior; state the remaining evidence boundary explicitly.
- Use Node.js 24 LTS, ESM, strict TypeScript, and the exact pnpm 11 release declared by `packageManager`. Commit `pnpm-lock.yaml`; do not use npm, Yarn, or Bun lockfiles.
- Use Biome for TypeScript and JavaScript formatting and linting, and markdownlint-cli2 for Markdown. Keep hooks check-only; use explicit `*:fix` commands for intentional rewrites.
- Run `pnpm quality:check` before merge. Keep one Linux quality workflow until product behavior creates a demonstrated need for another job.
- Do not introduce Nx, Turborepo, or another task orchestrator while pnpm workspaces and TypeScript project references are sufficient.
