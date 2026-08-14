# Engineering Instructions

## Product objective

Build a trustworthy, inspectable PR-review domain product. Keep one independently runnable TypeScript core and headless CLI, and expose the same review behavior as a trusted first-party Adam Agent extension when the public host Interface is available.

The product, package family, CLI executable and reserved Adam extension identity are `eve-reviewer`. Use the package scope `@eve-reviewer`, CLI executable `eve-reviewer`, future extension ID `eve-reviewer`, and contribution/storage namespace prefix `eve-reviewer` without legacy aliases.

Optimize for correct side-aware evidence, truthful analyzer coverage, bounded execution, safe host-brokered effects and a convincing review experience before expanding the feature surface.

## Engineering rules

- Deliver working end-to-end slices and keep the headless CLI runnable after every merged slice.
- Prefer the simplest complete design. Avoid speculative abstractions, configuration, indirection and extension points.
- Separate review semantics from analyzer execution, Adam integration, GitHub effects, storage and presentation Adapters.
- Treat repositories, diffs, base/head source, analyzer output, model output, feedback and host inputs as untrusted data.
- Keep source provenance and third-party license notices at file or Module level for reused or adapted code.
- Every behavior change and bug fix must include proportionate tests at a pre-agreed caller-visible seam.
- Linux is the only required platform until the first portfolio release is complete.
- Do not claim production readiness, complete analyzer coverage, sandbox strength or model improvement from deterministic or synthetic fixtures.

## Review-domain ownership

- Eve owns diff and snapshot consistency, changed-file classification, analyzer selection and output mapping, coverage, candidate findings, side-aware evidence, report semantics, review-domain records, feedback and evaluation.
- Adam owns extension activation, capability grants, operation/session truth, cancellation, deadlines, aggregate budgets, artifact identity, provider transport, Agent loops, permissions, secrets and host presentation shells.
- The core accepts bounded, serializable review input. Local or Adam Adapters resolve filesystem, repository-snapshot or artifact representations before calling core.
- Findings identify evidence with an explicit old/new side, safe relative path and line. Analyzer-provided evidence text is never authoritative.
- A zero-finding result must distinguish complete, partial and no-coverage outcomes. Unsupported, binary, deleted, metadata-only or unavailable content must not be reported as fully reviewed.
- Do not add a general Agent SDK, provider client, task runtime, permission system, queue, HTTP server or database to the core review path.
- Do not create a generic reviewer/plugin framework before two real implementations require the same Interface.

## Analyzer execution

- Deterministic analyzers are asynchronous and accept cancellation, a deadline and runtime-owned input/output/resource limits.
- Eve owns analyzer identity/profile, trusted configuration, result validation, provenance and candidate mapping; process or worker execution is an external Adapter.
- The standalone Adapter may invoke a pinned analyzer executable with bounded environment, output and cleanup.
- The Adam extension must use a declared, narrow, brokered analyzer capability. It must not import process/filesystem/network APIs as an undeclared host escape or accept arbitrary commands from review input.
- Do not generalize the analyzer broker into a process capability until a second real analyzer proves shared process requirements and a generic Interface is demonstrably smaller and safer.

## Domain and host state

- Version and runtime-validate serialized review input, coverage, findings, reports and domain errors at untrusted Adapter boundaries.
- Keep Adam operation/session/progress/event/artifact identifiers outside Eve domain schemas except as Adapter-level references.
- Persist only Eve-owned reports, findings, coverage, analyzer provenance, feedback, evaluation and domain indexes through the granted namespace.
- Never duplicate Adam operation lifecycle, cancellation, retry, deadline or terminal truth in an Eve task table.
- Keep the headless CLI stateless. Add a standalone server or database only after a real independent deployment requirement is accepted.
- Add compatibility code or migrations only for actual persisted Eve data or published contracts that require them.

## Model review and effects

- Model-assisted review uses Adam's narrowed managed-session capability. Eve owns reviewer prompts/recipes, structured candidate parsing, evidence validation and report integration.
- Never receive provider credentials, raw `ModelDriver`, unrestricted `AgentSession` or a second general Agent loop.
- GitHub input and publication use host-brokered authenticated capabilities. Eve owns review-specific mapping and comment/fix semantics, not secrets or unrestricted network access.
- Complete and verify review-comment publication before enabling a separate draft-fix capability.
- Auto-fix uses a new branch or patch artifact and never writes directly to the source branch.

## Presentation

- The headless CLI is the independent non-interactive surface.
- Eve contributes TUI commands/status/renderers only after Adam's base TUI is stable; it does not own terminal lifecycle or the main layout.
- Eve contributes Review, Trace, Feedback and Evaluation pages only through Adam's real Web Host and namespaced bridge; it does not build a competing application shell.
- TUI and Web share semantic commands, snapshots, events, domain schemas and artifact references, not renderer components.
- Require visible keyboard focus, non-color severity and coverage cues, and navigation to exact old/new-side evidence.
- Browser code never reads storage files, workspace files, provider credentials or private host state directly.

## Evaluation and evolution

- Start with versioned deterministic cases, explicit source classification, literal expected evidence/coverage and stable metrics.
- Keep live-provider checks opt-in and ordinary CI credential-free.
- Label synthetic evaluation as synthetic and keep it distinct from live-provider or production evidence.
- Do not automate prompt/rule evolution until real confirmed feedback, protected metrics, explicit candidate evaluation, promotion and rollback exist.

## Testing and toolchain

- Before writing a behavior test, name the public interface and observable result under test. Work one failing behavior test and the minimum implementation to pass it at a time.
- Do not pre-write a horizontal suite, inspect private state or mock Eve-owned review semantics. Fake external processes, Adam host capabilities, managed sessions, clocks, GitHub and filesystems only at their real seams.
- Use literal hand-authored diffs, base/head sources and expected evidence rather than production parsers or report builders to generate expected values.
- Add real Linux process evidence for analyzer cancellation, deadline and cleanup when that boundary exists.
- Run focused tests while iterating and the complete Linux check once before merge.
- A clean test run does not prove live Adam integration, provider, GitHub, browser, deployment or security behavior; state the remaining boundary explicitly.
- Use Node.js 24 LTS, ESM, strict TypeScript and the exact pnpm 11 release declared by `packageManager`. Commit `pnpm-lock.yaml`; do not use npm, Yarn or Bun lockfiles.
- Use Biome for TypeScript/JavaScript formatting and linting and markdownlint-cli2 for Markdown. Keep hooks check-only; use explicit `*:fix` commands for intentional rewrites.
- Run `pnpm quality:check` before merge. Keep one Linux quality workflow until a real Adapter requires another job.
- Do not introduce Nx, Turborepo or another task orchestrator while pnpm workspaces and TypeScript project references are sufficient.
