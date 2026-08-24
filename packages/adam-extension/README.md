# `@eve-reviewer/adam-extension`

Trusted Eve Reviewer extension for Adam Agent. It preserves `eve-reviewer.review@1` and adds `eve-reviewer.local-worktree-review@1`, whose static `/review` contribution accepts Adam's exact `adam.project-change-snapshot@1` input. Inside `execute()`, Eve maps that generic immutable snapshot to its local-worktree domain request, runs the fixed Adam Biome capability, publishes the canonical Eve report artifact, and creates an immutable operation record before returning a small terminal result. Its read-only recovery hook can reconstruct that terminal result from the exact immutable record after a Host restart without recapturing the project, rerunning review or repeating effects.

## Compatibility

- Node.js 24
- `@adam-agent/extension-api@0.3.0`
- `@eve-reviewer/core@0.2.0`

The package exposes one ESM root with the named `activate()` function expected by Adam's Extension Host. The local contribution declares only static command, project-change input-source and report-contract metadata; it receives no Git, filesystem, process, session-store or renderer handle. Configure it through Adam's extension installation and grant workflow; it does not provide a standalone CLI.

## License

Apache-2.0
