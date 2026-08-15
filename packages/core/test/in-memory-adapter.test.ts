import assert from "node:assert/strict";
import test from "node:test";

import {
  createInMemoryReviewAdapter,
  createReviewUseCase,
  reviewContractV1,
} from "../src/index.ts";

const context = {
  signal: new AbortController().signal,
  deadline: 10_000,
  limits: {
    maximumSourceFiles: 100,
    maximumSourceFileBytes: 1_000_000,
    maximumSnapshotBytes: 5_000_000,
    maximumStdoutBytes: 1_000_000,
    maximumStderrBytes: 1_000_000,
    maximumReportBytes: 5_000_000,
    terminationGraceMilliseconds: 100,
  },
};

test("matches direct review semantics with canonical JSON bytes", async () => {
  const request = {
    kind: "eve-reviewer.review-request",
    schemaVersion: 1,
    payload: {
      subject: {
        kind: "pull-request",
        repository: "example/repository",
        number: 7,
      },
      reviewer: "security",
      diff: [
        "diff --git a/src/value.ts b/src/value.ts",
        "--- a/src/value.ts",
        "+++ b/src/value.ts",
        "@@ -1 +1 @@",
        "-export const value = 1;",
        "+export const value = 2;",
        "",
      ].join("\n"),
      sources: {
        base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
        head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
      },
    },
  } as const;
  const useCase = createReviewUseCase({
    clock: () => 0,
    analyze: async () => [
      {
        kind: "eve-reviewer.analyzer-outcome",
        schemaVersion: 1,
        payload: {
          analyzer: {
            tool: "biome",
            version: "2.5.8",
            profile: "security",
            rules: ["lint/security/noGlobalEval"],
          },
          status: "analyzed",
          files: [{ side: "new", path: "src/value.ts", status: "analyzed" }],
          candidates: [],
        },
      },
    ],
  });
  const adapter = createInMemoryReviewAdapter({ review: useCase.review });

  const direct = await useCase.review(request, context);
  const encoded = reviewContractV1.encodeResult(direct);
  assert.equal(encoded.ok, true);
  assert.ok("value" in encoded);

  const actual = await adapter.review(JSON.stringify(request), context);

  assert.equal(actual, encoded.value);
  assert.deepEqual(JSON.parse(actual), direct);
});

test("returns canonical invalid-contract JSON without calling the use case", async () => {
  let calls = 0;
  const adapter = createInMemoryReviewAdapter({
    review: async () => {
      calls += 1;
      return {};
    },
  });

  const actual = await adapter.review("{", context);

  assert.equal(
    actual,
    '{"kind":"eve-reviewer.review-result","payload":{"error":{"code":"invalid-contract","issues":[{"code":"invalid-json","path":"/"}],"stage":"decode-request"},"ok":false},"schemaVersion":1}',
  );
  assert.equal(calls, 0);
});

test("enforces a caller-tightened request byte limit before parsing", async () => {
  let calls = 0;
  const adapter = createInMemoryReviewAdapter({
    maximumRequestBytes: 1,
    review: async () => {
      calls += 1;
      return {};
    },
  });

  const actual = await adapter.review("{}", context);

  assert.equal(
    actual,
    '{"kind":"eve-reviewer.review-result","payload":{"error":{"code":"invalid-contract","issues":[{"code":"max-bytes","path":"/"}],"stage":"decode-request"},"ok":false},"schemaVersion":1}',
  );
  assert.equal(calls, 0);
});

test("does not let a non-numeric caller limit bypass request bounds", async () => {
  let calls = 0;
  const adapter = createInMemoryReviewAdapter({
    maximumRequestBytes: Number.NaN,
    review: async () => {
      calls += 1;
      return {};
    },
  });

  const actual = await adapter.review("{}", context);

  assert.equal(
    actual,
    '{"kind":"eve-reviewer.review-result","payload":{"error":{"code":"invalid-contract","issues":[{"code":"max-bytes","path":"/"}],"stage":"decode-request"},"ok":false},"schemaVersion":1}',
  );
  assert.equal(calls, 0);
});

test("returns canonical invalid-contract JSON for an invalid use-case result", async () => {
  const adapter = createInMemoryReviewAdapter({
    review: async () => ({}),
  });

  const actual = await adapter.review("{}", context);

  assert.equal(
    actual,
    '{"kind":"eve-reviewer.review-result","payload":{"error":{"code":"invalid-contract","issues":[{"code":"required","path":"/"}],"stage":"encode-result"},"ok":false},"schemaVersion":1}',
  );
});

test("enforces a caller-tightened result byte limit after encoding", async () => {
  const adapter = createInMemoryReviewAdapter({
    maximumResultBytes: 1,
    review: async () => ({
      kind: "eve-reviewer.review-result",
      schemaVersion: 1,
      payload: {
        ok: false,
        error: { code: "cancelled", stage: "start" },
      },
    }),
  });

  const actual = await adapter.review("{}", context);

  assert.equal(
    actual,
    '{"kind":"eve-reviewer.review-result","payload":{"error":{"code":"invalid-contract","issues":[{"code":"max-bytes","path":"/"}],"stage":"encode-result"},"ok":false},"schemaVersion":1}',
  );
});

test("does not let a non-numeric caller limit bypass result bounds", async () => {
  const adapter = createInMemoryReviewAdapter({
    maximumResultBytes: Number.NaN,
    review: async () => ({
      kind: "eve-reviewer.review-result",
      schemaVersion: 1,
      payload: {
        ok: false,
        error: { code: "cancelled", stage: "start" },
      },
    }),
  });

  const actual = await adapter.review("{}", context);

  assert.equal(
    actual,
    '{"kind":"eve-reviewer.review-result","payload":{"error":{"code":"invalid-contract","issues":[{"code":"max-bytes","path":"/"}],"stage":"encode-result"},"ok":false},"schemaVersion":1}',
  );
});
