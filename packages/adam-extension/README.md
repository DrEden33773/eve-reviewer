# `@eve-reviewer/adam-extension`

Trusted Eve Reviewer extension for Adam Agent. It preserves `eve-reviewer.review@1` and adds `eve-reviewer.local-worktree-review@1`, whose static `/review` contribution accepts Adam's exact `adam.project-change-snapshot@1` input. Inside `execute()`, Eve maps that generic immutable snapshot to its local-worktree domain request, runs the fixed Adam Biome capability, publishes one bounded immutable model-evidence artifact, invokes one non-interactive `reviewer.v1` managed session through `adam.managed-session@1`, composes both outcomes through the existing core use case, publishes the canonical Eve report artifact and creates an immutable operation record before returning a small terminal result. Its read-only recovery hook reconstructs that terminal result from the exact immutable record after a Host restart without recapturing the project, rerunning deterministic/model review or repeating effects.

## Compatibility

- Node.js 24
- `@adam-agent/extension-api@0.4.0`
- `@eve-reviewer/core@0.3.0`

The package exposes one ESM root with the named `activate()` function expected by Adam's Extension Host. The local contribution declares only static command, project-change input-source, report-contract and exact managed-output metadata; it receives no provider, credentials, Git, filesystem, process, session-store, workspace root or renderer handle. Configure it through Adam's extension installation and grant workflow; it does not provide a standalone CLI.

## License

Apache-2.0
