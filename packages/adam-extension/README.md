# `@eve-reviewer/adam-extension`

Trusted Eve Reviewer extension for Adam Agent. It preserves `eve-reviewer.review@1` and `eve-reviewer.local-worktree-review@1`, whose static `/review` contribution accepts Adam's exact `adam.project-change-snapshot@1` input. Inside `execute()`, Eve maps that snapshot to its local-worktree domain request, runs the fixed Biome capability, publishes the bounded immutable model evidence once and invokes `adam.managed-review@1` with the evidence reference, a short instruction and the registered output contract. Core validates the decoded candidates and new review receipt before composing the required deterministic/model outcomes. Eve publishes the report and creates its immutable operation record before returning bounded references.

Typed model failure, capacity expiry, total review deadline, stall, budget exhaustion, invalid output and recovery remain distinct report diagnostics with deterministic findings retained and incomplete coverage. The ordinary operation result remains non-success. Cancel preserves the Host abort reason and prevents subsequent report/record effects. Eve reads the Host's current ordinary deadline after managed settlement; it does not grant time or infer a cumulative token/turn budget. Unknown managed execution failures become sanitized Operation failures before report/record publication. Host partial prose cannot become trusted findings, evidence, coverage or risk.

The adapter adds no provider, model loop, scheduler, watchdog, permission owner or Adam Store. Its existing read-only recovery hook reconstructs historical and new report results from exact immutable records without recapture, rerunning review or repeating effects. Public package/adapter-interface tests do not establish production Adam composition or live-model effectiveness.

## Compatibility

- Node.js 24
- `@adam-agent/extension-api@0.6.0`
- `@eve-reviewer/core@0.4.0`

The manifest negotiates API `>=0.6.0 <0.7.0` and requires capability `adam.managed-review@1` version `1.0.0`; the package peer and Core dependency above are exact.

The package exposes one ESM root with the named `activate()` function expected by Adam's Extension Host. The local contribution declares only static command, project-change input-source, report-contract and exact managed-output metadata; it receives no provider, credentials, Git, filesystem, process, session-store, workspace root or renderer handle. Configure it through Adam's extension installation and grant workflow; it does not provide a standalone CLI.

## License

Apache-2.0
