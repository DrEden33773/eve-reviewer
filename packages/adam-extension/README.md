# `@eve-reviewer/adam-extension`

Trusted Eve Reviewer extension for Adam Agent. It registers `eve-reviewer.review@1`, runs the fixed Adam Biome capability, publishes the canonical Eve report artifact, and creates an immutable operation record before returning a small terminal result.

Version `0.0.0-bootstrap.0` exists only to establish and secure the npm package identity under the non-default `bootstrap` tag. It is not a supported release and will be deprecated after identity bootstrap.

## Compatibility

- Node.js 24
- `@adam-agent/extension-api@0.1.0`
- `@eve-reviewer/core@0.0.0-bootstrap.0`

The package exposes one ESM root with the named `activate()` function expected by Adam's Extension Host. Configure it through Adam's extension installation and grant workflow; it does not provide a standalone CLI.

## License

Apache-2.0
