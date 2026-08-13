# Review fixtures

`dynamic-eval.diff` and `source/` form one review input: a unified diff plus its complete post-change source snapshot.

The source snapshot intentionally contains prohibited calls, misleading text, unused declarations, and compact formatting needed by the positive and negative review cases. It is excluded from the repository's ordinary Biome quality scan so the fixture remains byte-for-byte stable; the review CLI analyzes an isolated copy with its own trusted configuration.
