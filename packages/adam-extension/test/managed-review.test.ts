import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  type ExtensionManagedReviewRequest,
  type ExtensionManagedReviewTerminal,
  type ExtensionOperationContext,
  type ExtensionOperationRegistration,
  extensionManagedReviewRequestCodec,
} from "@adam-agent/extension-api";
import { activate } from "@eve-reviewer/adam-extension";
import { type ReviewResultEnvelope, reviewContractV1 } from "@eve-reviewer/core";

const digest = (value: string | Uint8Array): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const empty = {
  kind: "eve-reviewer.model-review-candidates",
  schemaVersion: 1,
  payload: { candidates: [] },
};
function completed(result: unknown = empty) {
  const bytes = JSON.stringify(result);
  return {
    status: "completed",
    result,
    receipt: {
      reviewRunId: "11111111-1111-4111-8111-111111111111",
      policyDigest: `sha256:${"a".repeat(64)}`,
      target: {
        targetId: "fixture.review",
        vendor: "fixture",
        modelId: "review-model",
        route: "direct",
        profileVersion: 1,
        certification: "certified",
      },
      evidenceSetDigest: `sha256:${"b".repeat(64)}`,
      output: {
        contract: { id: "eve-reviewer.model-review-candidates", version: 1 },
        digest: digest(bytes),
        byteCount: Buffer.byteLength(bytes),
      },
      traceDigest: `sha256:${"c".repeat(64)}`,
      usage: { inputTokens: 40_000, outputTokens: 7, reasoningTokens: 0, turns: 5 },
    },
  };
}

async function review(
  options: {
    padding?: string;
    effects?: string[];
    terminal?: (input: ExtensionManagedReviewRequest) => Promise<unknown>;
    ordinaryDeadlineExpired?: boolean;
  } = {},
) {
  let registration: ExtensionOperationRegistration | undefined;
  activate({
    compatibility: {
      api: { hostVersion: "0.6.0", requestedVersion: ">=0.6.0 <0.7.0" },
      capabilities: { optional: [], required: [] },
    },
    configuration: null,
    diagnostics: [],
    extension: {
      id: "eve-reviewer",
      packageName: "@eve-reviewer/adam-extension",
      version: "0.6.0",
    },
    registerOperation(value) {
      if (value.id === "eve-reviewer.local-worktree-review@1") registration = value;
    },
  });
  assert.ok(registration);
  const lines = [
    "export const value = 1;",
    ...(options.padding === undefined ? [] : [`//${options.padding}`]),
  ];
  const content = `${lines.join("\n")}\n`;
  const snapshot = {
    base: { kind: "head", commit: "a".repeat(40), tree: "b".repeat(40) },
    candidateTree: "c".repeat(40),
    capturePolicy: { id: "adam.git-project-changes", objectFormat: "sha1", version: 1 },
    digest: `sha256:${"d".repeat(64)}`,
    kind: "adam.project-change-snapshot",
    schemaVersion: 1,
    sources: [
      { content, contentDigest: digest(content), mode: "100644", path: "value.ts", side: "head" },
    ],
    unavailable: [],
    unifiedDiff: [
      "diff --git a/value.ts b/value.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/value.ts",
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
      "",
    ].join("\n"),
  };
  const decoded = registration.input.decode(snapshot);
  assert.ok(decoded.ok);
  const operationId = "22222222-2222-4222-8222-222222222222";
  const provenance = {
    contributionId: registration.id,
    extensionId: "eve-reviewer",
    extensionVersion: "0.6.0",
    projectId: `sha256:${"e".repeat(64)}` as const,
  };
  const effects: string[] = options.effects ?? [];
  const requests: ExtensionManagedReviewRequest[] = [];
  const evidence: Uint8Array[] = [];
  const reports: ReviewResultEnvelope[] = [];
  let settled = false;
  const context: ExtensionOperationContext = {
    budget: {
      inputBytes: Buffer.byteLength(JSON.stringify(snapshot)),
      outputBytesRemaining: 5_000_000,
      progressBytesRemaining: 1_000_000,
      progressRecordsRemaining: 256,
    },
    capabilities: {
      "adam.analyzer-execution.biome@1": {
        async analyze() {
          effects.push("analyze");
          return {
            execution: {
              analyzer: "biome",
              analyzerVersion: "2.5.8",
              exitCode: 0,
              profile: "adam-biome-recommended-v1",
              provenance: { ...provenance, operationId },
            },
            report: { command: "check", diagnostics: [], summary: { errors: 0, warnings: 0 } },
          };
        },
      },
      "adam.artifact.publish@1": {
        async publish(input) {
          const isEvidence = input.contract.id === "eve-reviewer.model-review-evidence";
          effects.push(isEvidence ? "evidence" : "report");
          if (isEvidence) evidence.push(input.bytes);
          else {
            const report = reviewContractV1.decodeResult(
              JSON.parse(new TextDecoder().decode(input.bytes)),
            );
            assert.ok(report.ok);
            reports.push(report.value);
          }
          return {
            byteCount: input.bytes.byteLength,
            contract: input.contract,
            id: digest(input.bytes),
            mediaType: input.mediaType,
            provenance: { ...provenance, operationId },
          };
        },
      },
      "adam.managed-review@1": {
        async review(input) {
          assert.ok(
            extensionManagedReviewRequestCodec.decode(input).ok,
            "The real public request codec must accept Eve evidence and instruction",
          );
          effects.push("managed");
          requests.push(input);
          const result = await (options.terminal?.(input) ?? Promise.resolve(completed()));
          settled = true;
          return result as ExtensionManagedReviewTerminal;
        },
      },
      "adam.storage.records@1": {
        async create(input) {
          effects.push("record");
          return {
            byteCount: Buffer.byteLength(JSON.stringify(input.value)),
            contract: input.contract,
            digest: digest(JSON.stringify(input.value)),
            key: input.key,
            provenance: { ...provenance, operationId },
          };
        },
        async get() {
          return undefined;
        },
        async list() {
          return { records: [] };
        },
      },
    },
    get deadlineAt() {
      return settled && options.ordinaryDeadlineExpired
        ? "2000-01-01T00:00:00.000Z"
        : "2099-01-01T00:00:00.000Z";
    },
    diagnostics: [],
    operationId,
    provenance,
    signal: new AbortController().signal,
    async progress() {},
  };
  const output = await registration.execute(decoded.value, context);
  assert.ok(registration.output.decode(output).ok);
  return { output, reports, requests, evidence, effects };
}

test("large review evidence crosses the managed boundary once with a short instruction", async () => {
  const result = await review({ padding: `EVIDENCE_MARKER_${"x".repeat(50_000)}` });
  assert.deepEqual(result.effects, ["analyze", "evidence", "managed", "report", "record"]);
  assert.equal(result.requests.length, 1);
  assert.equal(result.evidence.length, 1);
  const request = result.requests[0];
  assert.ok(request);
  assert.deepEqual(Object.keys(request).sort(), ["evidence", "instruction", "outputContract"]);
  assert.equal(request.evidence.length, 1);
  assert.ok((result.evidence[0]?.byteLength ?? 0) > 16_384);
  assert.ok(Buffer.byteLength(request.instruction) <= 16_384);
  assert.equal(request.instruction.includes("EVIDENCE_MARKER"), false);
  assert.equal(result.reports[0]?.payload.ok, true);
});

for (const [label, mutate] of [
  [
    "digest",
    (value: ReturnType<typeof completed>) => {
      value.receipt.output.digest = `sha256:${"f".repeat(64)}`;
    },
  ],
  [
    "size",
    (value: ReturnType<typeof completed>) => {
      value.receipt.output.byteCount += 1;
    },
  ],
  [
    "contract",
    (value: ReturnType<typeof completed>) => {
      value.receipt.output.contract.id = "wrong-output";
    },
  ],
] as const) {
  test(`forged output ${label} produces an incomplete report`, async () => {
    const result = await review({
      terminal: async () => {
        const value = completed();
        mutate(value);
        return value;
      },
    });
    const report = result.reports[0];
    assert.ok(report);
    assert.equal(report.payload.ok, false);
    if (report.payload.ok || !("partial" in report.payload))
      throw new Error("Expected partial report");
    assert.equal(report.payload.partial.coverage.status, "partial");
    assert.equal(report.payload.partial.diagnostics[0]?.code, "output_invalid");
  });
}

test("ordinary deadline resumes from Host truth after managed settlement", async () => {
  const result = await review({ ordinaryDeadlineExpired: true });
  const report = result.reports[0];
  assert.ok(report);
  assert.equal(report.payload.ok, false);
  if (report.payload.ok) throw new Error("Expired ordinary deadline cannot succeed");
  assert.equal(report.payload.error.code, "deadline-exceeded");
});

function candidate(line = 1) {
  return {
    ruleId: "example",
    severity: "low",
    title: "Changed value",
    explanation: "The changed value needs a test.",
    location: { side: "new", path: "value.ts", line },
    fixGuidance: "",
    suggestedTests: "",
    confidence: 0.5,
  };
}

test("one MiB managed output is decoded and all verified findings reach the report", async () => {
  const candidates = Array.from({ length: 100 }, () => ({
    ...candidate(),
    explanation: "x".repeat(8_192),
  }));
  const output = { ...empty, payload: { candidates } };
  let remaining = 1_048_576 - Buffer.byteLength(JSON.stringify(output));
  for (const value of candidates) {
    const length = Math.min(remaining, 8_192);
    value.fixGuidance = "x".repeat(length);
    remaining -= length;
  }
  assert.equal(remaining, 0);
  assert.equal(Buffer.byteLength(JSON.stringify(output)), 1_048_576);
  const result = await review({ terminal: async () => completed(output) });
  const report = result.reports[0];
  assert.ok(report);
  assert.equal(report.payload.ok, true);
  if (!report.payload.ok) throw new Error("Valid large output must compose");
  assert.equal(report.payload.report.findings.length, 100);
  assert.ok(
    report.payload.report.findings.every(
      (finding) => finding.evidence === "export const value = 1;",
    ),
  );
});

for (const [label, output, diagnostic] of [
  [
    "unavailable changed line",
    { ...empty, payload: { candidates: [candidate(2)] } },
    "invalid-model-evidence",
  ],
  [
    "model-authored evidence",
    { ...empty, payload: { candidates: [{ ...candidate(), evidence: "invented" }] } },
    "output_invalid",
  ],
] as const) {
  test(`${label} cannot produce a successful review`, async () => {
    const result = await review({ terminal: async () => completed(output) });
    const report = result.reports[0];
    assert.ok(report);
    assert.equal(report.payload.ok, false);
    if (report.payload.ok || !("partial" in report.payload))
      throw new Error("Expected partial result");
    assert.equal(report.payload.partial.findings.length, 0);
    assert.equal(report.payload.partial.diagnostics[0]?.code, diagnostic);
  });
}

test("unknown managed failures reach OperationHost without report effects", async () => {
  const effects: string[] = [];
  await assert.rejects(
    () =>
      review({
        effects,
        terminal: async () => {
          throw new Error("untrusted transport detail");
        },
      }),
    { message: "Managed review did not return a terminal result." },
  );
  assert.deepEqual(effects, ["analyze", "evidence", "managed"]);
});
