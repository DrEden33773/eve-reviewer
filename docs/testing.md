# Testing Guide

Use this guide with the [engineering instructions](../AGENTS.md) and the current task's acceptance requirements.

## Choose evidence that fits the change

Identify the observable behavior and the narrowest existing interface that proves it. Routine test selection within accepted scope needs no separate approval. Reproduce a defect and retain meaningful regression evidence; add or update behavior tests when existing coverage does not establish the requested outcome. Explicit test-first requests and ordered RED/GREEN contracts remain binding. Documentation, formatting and mechanical changes use proportionate checks without an artificial failing test.

Expected values come from independent worked literals, hand-authored diffs and base/head sources, or an accepted external contract. Do not derive expected evidence from the parser or report builder under test. Do not inspect private state or internal call order, or mock Eve-owned review semantics. Fake external analyzers, Adam capabilities, managed sessions, clocks, filesystems and GitHub only at their actual adapter interfaces.

Keep each test independent of suite order and mutable shared fixtures. Related examples of one behavior may share a parameterized case or a focused run; do not turn each assertion into a separate implementation cycle. Preserve inputs, observable outcomes and failure classifications when moving a test to a cheaper seam.

## Review and adapter seams

| Behavior | Evidence |
| --- | --- |
| Diff, sources, coverage and findings | Exported parser, codecs and review use cases with literal old/new-side evidence, unavailable content, typed rejection and truthful partial coverage |
| Analyzer policy and mapping | Review use case or analyzer adapter with a controlled external executor; verify selection, bounded outcomes and provenance |
| Linux analyzer and CLI | Real process, stream and filesystem behavior where signals, deadlines, output limits, confinement or cleanup require the OS |
| Adam integration and managed review | Published Extension API capabilities with the real Eve core; verify cancellation, typed partial results, evidence/report/record ordering and read-only recovery |
| Evaluation | Versioned literal cases and protected metrics; keep synthetic evidence distinct from live-model effectiveness |

Keep semantic tests below expensive OS adapters. Each real process or filesystem test should prove a unique external contract. Model tests validate structured results and evidence rather than exact model prose. Live-provider, live-GitHub, real Adam composition and browser checks require their own task-specific evidence; ordinary CI is credential-free.

Keep structural checks only for concrete public API, dependency or authority boundaries that behavior or type checks do not already cover. Do not snapshot source spelling, complete import lists, test inventories or CI script text.

## Causal synchronization and resource ownership

Synchronize on the exact event, IPC message, stream contents, durable state or child closure needed before the next action. A prepared file does not prove that an analyzer process started. Filesystem notifications are wake-ups; read and validate the relevant durable state rather than treating the notification as truth. Avoid global temporary-directory scans, arbitrary sleeps and elapsed-time assertions as success criteria.

Timeouts are bounded failure and cleanup guards that identify the missing state and leave time for reclamation. Test deadline policy with a fake clock where an existing seam supports it; use real timers for actual timer/OS contracts. Do not remove a real cancellation or cleanup assertion merely to shorten a test. A blocked fixture should wait for a controlled event or open stream rather than a finite sleep.

A child `error` reports failure; only `close` establishes process and stream reclamation. Track child ownership through close and bound cleanup through TERM then KILL where needed. Consume background cleanup failures. Tests own their temporary resources and relevant inherited environment for their complete lifetime; restore any changed state.

The CLI signal suite starts a controlled real external analyzer through a test-only Node preload at the child-process boundary. The analyzer stays alive on IPC, reports readiness from inside the child, and is reclaimed by the real Eve executor after the real CLI receives SIGINT or SIGTERM. The suite checks analyzer close, CLI output/exit and directory cleanup with a one-line diff. Separate local-Biome tests retain pinned-binary execution and real process cancellation coverage.

## Commands and final checks

Run `pnpm test <test-file> [more test files]` for one build followed by only those files. Add `-t '<name>'` (or `--name '<name>'`) to select cases. With no file selection, `pnpm test` runs the complete suite. When package output is already current, `pnpm test:run <test-file>` skips the build; final Quality uses that entry after typecheck has refreshed package output. The runner preserves Node test isolation and propagates failures.

Review the complete candidate diff against the request and engineering rules. Run `pnpm quality:check` once on the final candidate before its pull request and require hosted `quality` before merge. Subsequent product edits require a new full candidate check. An unchanged successful candidate needs no routine repeat unless an explicit gate or new evidence requires it.

When a test fails, inspect its required state and resource owner before calling it flaky. Reproduce through the focused case and owning file; investigate contention or inherited environment when evidence points there. Repair the cause rather than weakening assertions or hiding ordering defects with retries, timeouts or worker limits. Measurements guide engineering decisions; they are not CI latency thresholds without an explicit performance contract.
