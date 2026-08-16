// biome-ignore-all lint/complexity/useLiteralKeys: Package manifest fixtures are decoded as unknown records.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  type ExtensionActivationContext,
  type ExtensionJsonValue,
  type ExtensionOperationContext,
  type ExtensionOperationRegistration,
  parseExtensionPackageManifest,
} from "@adam-agent/extension-api";

test("the package manifest declares the exact Eve operation and required Adam capabilities", () => {
  const manifest = parseExtensionPackageManifest(
    JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")),
  );

  assert.deepEqual(manifest.adamAgent, {
    id: "eve-reviewer",
    apiVersion: "0.1.0",
    runtime: { entry: "./dist/index.js" },
    capabilities: {
      required: [
        { id: "adam.analyzer-execution.biome@1", version: "1.0.0" },
        { id: "adam.artifact.publish@1", version: "1.0.0" },
        { id: "adam.storage.records@1", version: "1.0.0" },
      ],
      optional: [],
    },
    contributions: [
      {
        kind: "operation",
        id: "eve-reviewer.review@1",
        input: { id: "eve-reviewer.review-request", version: 1 },
        output: { id: "eve-reviewer.operation-result", version: 1 },
        progress: { id: "eve-reviewer.review-progress", version: 1 },
      },
    ],
  });
});

test("the supported extension artifact pins the matching core with provenance enabled", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;

  assert.deepEqual(
    {
      name: manifest["name"],
      version: manifest["version"],
      exports: manifest["exports"],
      files: manifest["files"],
      dependencies: manifest["dependencies"],
      peerDependencies: manifest["peerDependencies"],
      devDependencies: manifest["devDependencies"],
      publishConfig: manifest["publishConfig"],
    },
    {
      name: "@eve-reviewer/adam-extension",
      version: "0.1.0",
      exports: {
        ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      },
      files: ["dist", "LICENSE", "README.md"],
      dependencies: { "@eve-reviewer/core": "workspace:0.1.0" },
      peerDependencies: { "@adam-agent/extension-api": "0.1.0" },
      devDependencies: { "@adam-agent/extension-api": "0.1.0" },
      publishConfig: { access: "public", provenance: true },
    },
  );
});

import { activate } from "@eve-reviewer/adam-extension";

test("activate registers the versioned Eve review operation", async () => {
  let registration: ExtensionOperationRegistration | undefined;
  const context = {
    compatibility: {
      api: { hostVersion: "0.1.0", requestedVersion: "0.1.0" },
      capabilities: {
        optional: [],
        required: [
          {
            id: "adam.analyzer-execution.biome@1",
            requestedVersion: "^1.0.0",
            availableVersion: "1.0.0",
            granted: true,
          },
          {
            id: "adam.artifact.publish@1",
            requestedVersion: "^1.0.0",
            availableVersion: "1.0.0",
            granted: true,
          },
          {
            id: "adam.storage.records@1",
            requestedVersion: "^1.0.0",
            availableVersion: "1.0.0",
            granted: true,
          },
        ],
      },
    },
    configuration: null,
    diagnostics: [],
    extension: {
      id: "eve-reviewer",
      packageName: "@eve-reviewer/adam-extension",
      version: "0.1.0",
    },
    registerOperation(value) {
      registration = value;
    },
  } satisfies ExtensionActivationContext;

  await activate(context);

  assert.ok(registration);
  assert.deepEqual(
    {
      id: registration.id,
      input: { id: registration.input.id, version: registration.input.version },
      output: { id: registration.output.id, version: registration.output.version },
      progress: { id: registration.progress.id, version: registration.progress.version },
    },
    {
      id: "eve-reviewer.review@1",
      input: { id: "eve-reviewer.review-request", version: 1 },
      output: { id: "eve-reviewer.operation-result", version: 1 },
      progress: { id: "eve-reviewer.review-progress", version: 1 },
    },
  );
});

test("the review input codec rejects unsupported Eve schema versions", async () => {
  let registration: ExtensionOperationRegistration | undefined;
  const context = {
    compatibility: {
      api: { hostVersion: "0.1.0", requestedVersion: "0.1.0" },
      capabilities: { optional: [], required: [] },
    },
    configuration: null,
    diagnostics: [],
    extension: {
      id: "eve-reviewer",
      packageName: "@eve-reviewer/adam-extension",
      version: "0.1.0",
    },
    registerOperation(value) {
      registration = value;
    },
  } satisfies ExtensionActivationContext;

  await activate(context);

  assert.ok(registration);
  assert.deepEqual(
    registration.input.decode({
      kind: "eve-reviewer.review-request",
      schemaVersion: 2,
      payload: {},
    }),
    {
      ok: false,
      issues: [{ path: "/schemaVersion", code: "unsupported" }],
    },
  );
});

test("a successful review durably publishes its report before returning small references", async () => {
  const registration = registeredReviewOperation();
  const effects: string[] = [];
  const progress: unknown[] = [];
  let analyzerInput: unknown;
  let published: { bytes: Uint8Array; contract: unknown; mediaType: string } | undefined;
  let stored: { key: string; contract: unknown; value: unknown } | undefined;
  const provenance = {
    contributionId: "eve-reviewer.review@1",
    extensionId: "eve-reviewer",
    extensionVersion: "0.1.0",
    projectId: "sha256:project",
  } as const;
  const operationId = "operation-1";
  const context = {
    budget: {
      inputBytes: 1_024,
      outputBytesRemaining: 5_000_000,
      progressBytesRemaining: 1_000_000,
      progressRecordsRemaining: 256,
    },
    capabilities: {
      "adam.analyzer-execution.biome@1": {
        async analyze(input) {
          effects.push("analyze");
          analyzerInput = input;
          return {
            execution: {
              analyzer: "biome",
              analyzerVersion: "2.5.8",
              exitCode: 0,
              profile: "adam-biome-recommended-v1",
              provenance: { ...provenance, operationId },
            },
            report: {
              command: "check",
              diagnostics: [],
              summary: { errors: 0, warnings: 0 },
            },
          };
        },
      },
      "adam.artifact.publish@1": {
        async publish(input) {
          effects.push("artifact");
          published = input;
          return {
            byteCount: input.bytes.byteLength,
            contract: input.contract,
            id: "sha256:report",
            mediaType: input.mediaType,
            provenance: { ...provenance, operationId },
          };
        },
      },
      "adam.storage.records@1": {
        async create(input) {
          effects.push("record");
          stored = input;
          return {
            byteCount: 512,
            contract: input.contract,
            digest: "sha256:record",
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
    deadlineAt: "2099-01-01T00:00:00.000Z",
    diagnostics: [],
    operationId,
    provenance,
    signal: new AbortController().signal,
    async progress(value) {
      progress.push(value);
    },
  } satisfies ExtensionOperationContext;

  const output = await registration.execute(reviewRequest(), context);

  assert.ok(published);
  assert.ok(stored);
  const artifactResult = JSON.parse(new TextDecoder().decode(published.bytes));
  const storedValue = stored.value as {
    artifact: unknown;
    kind: string;
    result: unknown;
    schemaVersion: number;
  };
  assert.deepEqual(
    {
      analyzerInput,
      artifact: {
        contract: published.contract,
        mediaType: published.mediaType,
        result: reviewResultSummary(artifactResult),
      },
      effects,
      output,
      progress,
      record: {
        contract: stored.contract,
        key: stored.key,
        value: {
          artifact: storedValue.artifact,
          kind: storedValue.kind,
          result: reviewResultSummary(storedValue.result),
          schemaVersion: storedValue.schemaVersion,
        },
      },
    },
    {
      analyzerInput: {
        files: [{ content: "export const value = 1;\n", path: "src/value.ts" }],
        profile: "adam-biome-recommended-v1",
      },
      artifact: {
        contract: { id: "eve-reviewer.review-result", version: 1 },
        mediaType: "application/json",
        result: {
          coverage: "complete",
          findings: 0,
          kind: "eve-reviewer.review-result",
          ok: true,
          risk: "none",
          schemaVersion: 1,
        },
      },
      effects: ["analyze", "artifact", "record"],
      output: {
        kind: "eve-reviewer.operation-result",
        schemaVersion: 1,
        payload: {
          ok: true,
          artifact: {
            contract: { id: "eve-reviewer.review-result", version: 1 },
            id: "sha256:report",
          },
          record: {
            contract: { id: "eve-reviewer.operation-record", version: 1 },
            digest: "sha256:record",
            key: "operations/operation-1",
          },
          summary: { coverage: "complete", findings: 0, risk: "none" },
        },
      },
      progress: [
        {
          kind: "eve-reviewer.review-progress",
          schemaVersion: 1,
          payload: { stage: "analyzing" },
        },
        {
          kind: "eve-reviewer.review-progress",
          schemaVersion: 1,
          payload: { stage: "publishing" },
        },
      ],
      record: {
        contract: { id: "eve-reviewer.operation-record", version: 1 },
        key: "operations/operation-1",
        value: {
          artifact: {
            contract: { id: "eve-reviewer.review-result", version: 1 },
            id: "sha256:report",
          },
          kind: "eve-reviewer.operation-record",
          result: {
            coverage: "complete",
            findings: 0,
            kind: "eve-reviewer.review-result",
            ok: true,
            risk: "none",
            schemaVersion: 1,
          },
          schemaVersion: 1,
        },
      },
    },
  );
});

test("an artifact failure prevents record creation and terminal success", async () => {
  const registration = registeredReviewOperation();
  const publishFailure = new Error("artifact unavailable");
  let recordCreated = false;
  const provenance = {
    contributionId: "eve-reviewer.review@1",
    extensionId: "eve-reviewer",
    extensionVersion: "0.1.0",
    projectId: "sha256:project",
  } as const;
  const operationId = "operation-artifact-failure";
  const context = {
    budget: {
      inputBytes: 1_024,
      outputBytesRemaining: 5_000_000,
      progressBytesRemaining: 1_000_000,
      progressRecordsRemaining: 256,
    },
    capabilities: {
      "adam.analyzer-execution.biome@1": {
        async analyze() {
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
        async publish() {
          throw publishFailure;
        },
      },
      "adam.storage.records@1": {
        async create() {
          recordCreated = true;
          throw new Error("record creation must not run");
        },
        async get() {
          return undefined;
        },
        async list() {
          return { records: [] };
        },
      },
    },
    deadlineAt: "2099-01-01T00:00:00.000Z",
    diagnostics: [],
    operationId,
    provenance,
    signal: new AbortController().signal,
    async progress() {},
  } satisfies ExtensionOperationContext;

  await assert.rejects(
    async () => await registration.execute(reviewRequest(), context),
    publishFailure,
  );
  assert.equal(recordCreated, false);
});

test("an invalid artifact summary prevents record creation and terminal success", async () => {
  const registration = registeredReviewOperation();
  let recordCreated = false;
  const provenance = {
    contributionId: "eve-reviewer.review@1",
    extensionId: "eve-reviewer",
    extensionVersion: "0.1.0",
    projectId: "sha256:project",
  } as const;
  const operationId = "operation-invalid-artifact";
  const context = {
    budget: {
      inputBytes: 1_024,
      outputBytesRemaining: 5_000_000,
      progressBytesRemaining: 1_000_000,
      progressRecordsRemaining: 256,
    },
    capabilities: {
      "adam.analyzer-execution.biome@1": {
        async analyze() {
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
          return {
            byteCount: input.bytes.byteLength,
            contract: { id: "another.report", version: 1 },
            id: "sha256:report",
            mediaType: input.mediaType,
            provenance: { ...provenance, operationId },
          } as never;
        },
      },
      "adam.storage.records@1": {
        async create() {
          recordCreated = true;
          throw new Error("record creation must not run");
        },
        async get() {
          return undefined;
        },
        async list() {
          return { records: [] };
        },
      },
    },
    deadlineAt: "2099-01-01T00:00:00.000Z",
    diagnostics: [],
    operationId,
    provenance,
    signal: new AbortController().signal,
    async progress() {},
  } satisfies ExtensionOperationContext;

  await assert.rejects(
    async () => await registration.execute(reviewRequest(), context),
    /invalid artifact summary/u,
  );
  assert.equal(recordCreated, false);
});

test("an invalid record summary prevents terminal success", async () => {
  const registration = registeredReviewOperation();
  const provenance = {
    contributionId: "eve-reviewer.review@1",
    extensionId: "eve-reviewer",
    extensionVersion: "0.1.0",
    projectId: "sha256:project",
  } as const;
  const operationId = "operation-invalid-record";
  const context = {
    budget: {
      inputBytes: 1_024,
      outputBytesRemaining: 5_000_000,
      progressBytesRemaining: 1_000_000,
      progressRecordsRemaining: 256,
    },
    capabilities: {
      "adam.analyzer-execution.biome@1": {
        async analyze() {
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
          return {
            byteCount: input.bytes.byteLength,
            contract: input.contract,
            id: "sha256:report",
            mediaType: input.mediaType,
            provenance: { ...provenance, operationId },
          };
        },
      },
      "adam.storage.records@1": {
        async create(input) {
          return {
            byteCount: 512,
            contract: input.contract,
            digest: "sha256:record",
            key: "operations/another-operation",
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
    deadlineAt: "2099-01-01T00:00:00.000Z",
    diagnostics: [],
    operationId,
    provenance,
    signal: new AbortController().signal,
    async progress() {},
  } satisfies ExtensionOperationContext;

  await assert.rejects(
    async () => await registration.execute(reviewRequest(), context),
    /invalid record summary/u,
  );
});

test("the Adam Biome report maps a changed-line security diagnostic into Eve evidence", async () => {
  const result = await reviewResultForBiomeReport(
    {
      command: "check",
      diagnostics: [
        {
          severity: "warning",
          message: "Another recommended rule is outside Eve's selected deterministic rule.",
          category: "lint/style/useConst",
          location: {
            path: "src/value.ts",
            start: { line: 1, column: 1 },
            end: { line: 1, column: 7 },
          },
          advices: [],
        },
        {
          severity: "error",
          message: "eval() exposes to security risks and performance issues.",
          category: "lint/security/noGlobalEval",
          location: {
            path: "src/value.ts",
            start: { line: 1, column: 22 },
            end: { line: 1, column: 26 },
          },
          advices: [],
        },
      ],
      summary: { errors: 1, warnings: 1 },
    },
    dynamicEvalReviewRequest(),
  );

  assert.deepEqual(result.payload.report?.findings, [
    {
      ruleId: "security/no-dynamic-eval",
      severity: "critical",
      title: "Dynamic code evaluation",
      explanation: "Code added by the change evaluates text as executable code.",
      location: { side: "new", path: "src/value.ts", line: 1 },
      evidence: "export const value = eval(input);",
      fixGuidance: "Replace eval with an explicit parser or an allow-listed operation map.",
      suggestedTests: "Exercise hostile and malformed input and assert it is never executed.",
      confidence: 0.95,
      provenance: {
        tool: "biome",
        version: "2.5.8",
        ruleId: "lint/security/noGlobalEval",
      },
    },
  ]);
});

test("unsupported changed files produce no coverage without invoking the Biome broker", async () => {
  let biomeCalled = false;
  const result = await reviewResultForBiomeReport(
    { command: "check", diagnostics: [], summary: { errors: 0, warnings: 0 } },
    unsupportedReviewRequest(),
    () => {
      biomeCalled = true;
    },
  );

  assert.deepEqual(
    {
      biomeCalled,
      coverage: result.payload.report?.coverage.status,
      findings: result.payload.report?.findings,
    },
    { biomeCalled: false, coverage: "no-coverage", findings: [] },
  );
});

test("an invalid successful Biome response remains a required analyzer failure", async () => {
  const result = await reviewResultForBiomeReport({
    command: "check",
    diagnostics: "not-an-array",
    summary: { errors: 0, warnings: 0 },
  });

  assert.deepEqual(
    {
      error: result.payload.error,
      diagnostics: result.payload.partial?.diagnostics,
    },
    {
      error: { code: "required-analyzer-failed", stage: "analyze" },
      diagnostics: [
        {
          analyzer: {
            tool: "biome",
            version: "2.5.8",
            profile: "adam-biome-recommended-v1",
            rules: ["lint/security/noGlobalEval"],
          },
          code: "invalid-analyzer-output",
          message: "The Biome broker returned an invalid report.",
        },
      ],
    },
  );
});

test("mismatched Adam Biome execution provenance fails closed", async () => {
  const result = await reviewResultForBiomeReport(
    { command: "check", diagnostics: [], summary: { errors: 0, warnings: 0 } },
    reviewRequest(),
    () => {},
    "9.9.9",
  );

  assert.deepEqual(result.payload.partial?.diagnostics, [
    {
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "adam-biome-recommended-v1",
        rules: ["lint/security/noGlobalEval"],
      },
      code: "invalid-analyzer-output",
      message: "The Biome broker returned an invalid response.",
    },
  ]);
});

test("mismatched Adam operation provenance fails closed", async () => {
  const result = await reviewResultForBiomeReport(
    { command: "check", diagnostics: [], summary: { errors: 0, warnings: 0 } },
    reviewRequest(),
    () => {},
    "2.5.8",
    "sha256:another-project",
  );

  assert.deepEqual(result.payload.partial?.diagnostics, [
    {
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "adam-biome-recommended-v1",
        rules: ["lint/security/noGlobalEval"],
      },
      code: "invalid-analyzer-output",
      message: "The Biome broker returned an invalid response.",
    },
  ]);
});

test("unknown Adam Biome report fields fail closed", async () => {
  const result = await reviewResultForBiomeReport({
    command: "check",
    diagnostics: [],
    summary: { errors: 0, warnings: 0, undocumented: 0 },
  });

  assert.deepEqual(result.payload.partial?.diagnostics, [
    {
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "adam-biome-recommended-v1",
        rules: ["lint/security/noGlobalEval"],
      },
      code: "invalid-analyzer-output",
      message: "The Biome broker returned an invalid report.",
    },
  ]);
});

test("a truncated Adam Biome report cannot claim analyzed coverage", async () => {
  const result = await reviewResultForBiomeReport({
    command: "check",
    diagnostics: [],
    summary: { diagnosticsNotPrinted: 1, errors: 1, warnings: 0 },
  });

  assert.deepEqual(result.payload.partial?.diagnostics, [
    {
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "adam-biome-recommended-v1",
        rules: ["lint/security/noGlobalEval"],
      },
      code: "invalid-analyzer-output",
      message: "The Biome broker returned an invalid report.",
    },
  ]);
});

test("a skipped Adam Biome file cannot claim analyzed coverage", async () => {
  const result = await reviewResultForBiomeReport({
    command: "check",
    diagnostics: [],
    summary: { errors: 0, skipped: 1, warnings: 0 },
  });

  assert.deepEqual(result.payload.partial?.diagnostics, [
    {
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "adam-biome-recommended-v1",
        rules: ["lint/security/noGlobalEval"],
      },
      code: "invalid-analyzer-output",
      message: "The Biome broker returned an invalid report.",
    },
  ]);
});

test("the operation result codec rejects unknown payload fields", () => {
  const registration = registeredReviewOperation();

  assert.deepEqual(
    registration.output.decode({
      kind: "eve-reviewer.operation-result",
      schemaVersion: 1,
      payload: {
        ok: true,
        artifact: {
          contract: { id: "eve-reviewer.review-result", version: 1 },
          id: "sha256:report",
        },
        record: {
          contract: { id: "eve-reviewer.operation-record", version: 1 },
          digest: "sha256:record",
          key: "operations/operation-1",
        },
        summary: { coverage: "complete", findings: 0, risk: "none" },
        unexpected: true,
      },
    }),
    {
      ok: false,
      issues: [{ path: "/payload/unexpected", code: "unknown-field" }],
    },
  );
});

test("the operation result codec rejects unknown artifact reference fields", () => {
  const registration = registeredReviewOperation();

  assert.deepEqual(
    registration.output.decode({
      kind: "eve-reviewer.operation-result",
      schemaVersion: 1,
      payload: {
        ok: true,
        artifact: {
          contract: { id: "eve-reviewer.review-result", version: 1 },
          id: "sha256:report",
          unexpected: true,
        },
        record: {
          contract: { id: "eve-reviewer.operation-record", version: 1 },
          digest: "sha256:record",
          key: "operations/operation-1",
        },
        summary: { coverage: "complete", findings: 0, risk: "none" },
      },
    }),
    {
      ok: false,
      issues: [{ path: "/payload/artifact/unexpected", code: "unknown-field" }],
    },
  );
});

test("the operation result codec requires the durable record reference", () => {
  const registration = registeredReviewOperation();

  assert.deepEqual(
    registration.output.decode({
      kind: "eve-reviewer.operation-result",
      schemaVersion: 1,
      payload: {
        ok: true,
        artifact: {
          contract: { id: "eve-reviewer.review-result", version: 1 },
          id: "sha256:report",
        },
        summary: { coverage: "complete", findings: 0, risk: "none" },
      },
    }),
    {
      ok: false,
      issues: [{ path: "/payload/record", code: "object" }],
    },
  );
});

test("the operation result codec rejects unknown durable record fields", () => {
  const registration = registeredReviewOperation();

  assert.deepEqual(
    registration.output.decode({
      kind: "eve-reviewer.operation-result",
      schemaVersion: 1,
      payload: {
        ok: true,
        artifact: {
          contract: { id: "eve-reviewer.review-result", version: 1 },
          id: "sha256:report",
        },
        record: {
          contract: { id: "eve-reviewer.operation-record", version: 1 },
          digest: "sha256:record",
          key: "operations/operation-1",
          unexpected: true,
        },
        summary: { coverage: "complete", findings: 0, risk: "none" },
      },
    }),
    {
      ok: false,
      issues: [{ path: "/payload/record/unexpected", code: "unknown-field" }],
    },
  );
});

test("the operation result codec rejects a mismatched report contract", () => {
  const registration = registeredReviewOperation();

  assert.deepEqual(
    registration.output.decode({
      kind: "eve-reviewer.operation-result",
      schemaVersion: 1,
      payload: {
        ok: true,
        artifact: {
          contract: { id: "another.report", version: 1 },
          id: "sha256:report",
        },
        record: {
          contract: { id: "eve-reviewer.operation-record", version: 1 },
          digest: "sha256:record",
          key: "operations/operation-1",
        },
        summary: { coverage: "complete", findings: 0, risk: "none" },
      },
    }),
    {
      ok: false,
      issues: [{ path: "/payload/artifact/contract/id", code: "literal" }],
    },
  );
});

test("the operation result codec rejects a mismatched operation record contract", () => {
  const registration = registeredReviewOperation();

  assert.deepEqual(
    registration.output.decode({
      kind: "eve-reviewer.operation-result",
      schemaVersion: 1,
      payload: {
        ok: true,
        artifact: {
          contract: { id: "eve-reviewer.review-result", version: 1 },
          id: "sha256:report",
        },
        record: {
          contract: { id: "another.record", version: 1 },
          digest: "sha256:record",
          key: "operations/operation-1",
        },
        summary: { coverage: "complete", findings: 0, risk: "none" },
      },
    }),
    {
      ok: false,
      issues: [{ path: "/payload/record/contract/id", code: "literal" }],
    },
  );
});

test("the operation result codec keeps success and failure summaries disjoint", () => {
  const registration = registeredReviewOperation();

  assert.deepEqual(
    registration.output.decode({
      kind: "eve-reviewer.operation-result",
      schemaVersion: 1,
      payload: {
        ok: true,
        artifact: {
          contract: { id: "eve-reviewer.review-result", version: 1 },
          id: "sha256:report",
        },
        record: {
          contract: { id: "eve-reviewer.operation-record", version: 1 },
          digest: "sha256:record",
          key: "operations/operation-1",
        },
        summary: { error: "invalid-diff" },
      },
    }),
    {
      ok: false,
      issues: [{ path: "/payload/summary/error", code: "unknown-field" }],
    },
  );
});

test("the review progress codec rejects unknown payload fields", () => {
  const registration = registeredReviewOperation();

  assert.deepEqual(
    registration.progress.decode({
      kind: "eve-reviewer.review-progress",
      schemaVersion: 1,
      payload: { stage: "analyzing", unexpected: true },
    }),
    {
      ok: false,
      issues: [{ path: "/payload/unexpected", code: "unknown-field" }],
    },
  );
});

function registeredReviewOperation(): ExtensionOperationRegistration {
  let registration: ExtensionOperationRegistration | undefined;
  activate({
    compatibility: {
      api: { hostVersion: "0.1.0", requestedVersion: "0.1.0" },
      capabilities: { optional: [], required: [] },
    },
    configuration: null,
    diagnostics: [],
    extension: {
      id: "eve-reviewer",
      packageName: "@eve-reviewer/adam-extension",
      version: "0.1.0",
    },
    registerOperation(value) {
      registration = value;
    },
  });
  assert.ok(registration);
  return registration;
}

function reviewRequest() {
  return {
    kind: "eve-reviewer.review-request",
    schemaVersion: 1,
    payload: {
      subject: {
        kind: "pull-request",
        repository: "example/repository",
        number: 7,
      },
      reviewer: "deterministic-security",
      diff: [
        "diff --git a/src/value.ts b/src/value.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/src/value.ts",
        "@@ -0,0 +1 @@",
        "+export const value = 1;",
        "",
      ].join("\n"),
      sources: {
        base: [],
        head: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
      },
    },
  } as const;
}

function dynamicEvalReviewRequest() {
  return {
    ...reviewRequest(),
    payload: {
      ...reviewRequest().payload,
      diff: [
        "diff --git a/src/value.ts b/src/value.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/src/value.ts",
        "@@ -0,0 +1 @@",
        "+export const value = eval(input);",
        "",
      ].join("\n"),
      sources: {
        base: [],
        head: [{ path: "src/value.ts", content: "export const value = eval(input);\n" }],
      },
    },
  } as const;
}

function unsupportedReviewRequest() {
  return {
    ...reviewRequest(),
    payload: {
      ...reviewRequest().payload,
      diff: [
        "diff --git a/README.md b/README.md",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/README.md",
        "@@ -0,0 +1 @@",
        "+# Documentation",
        "",
      ].join("\n"),
      sources: {
        base: [],
        head: [{ path: "README.md", content: "# Documentation\n" }],
      },
    },
  } as const;
}

function reviewResultSummary(value: unknown) {
  const result = value as {
    kind: string;
    schemaVersion: number;
    payload: {
      ok: boolean;
      report?: {
        coverage: { status: string };
        findings: unknown[];
        risk: string;
      };
    };
  };
  return {
    kind: result.kind,
    schemaVersion: result.schemaVersion,
    ok: result.payload.ok,
    coverage: result.payload.report?.coverage.status,
    findings: result.payload.report?.findings.length,
    risk: result.payload.report?.risk,
  };
}

async function reviewResultForBiomeReport(
  report: ExtensionJsonValue,
  request: unknown = reviewRequest(),
  onAnalyze: () => void = () => {},
  analyzerVersion = "2.5.8",
  analyzerProjectId = "sha256:project",
) {
  const registration = registeredReviewOperation();
  let artifactBytes: Uint8Array | undefined;
  const provenance = {
    contributionId: "eve-reviewer.review@1",
    extensionId: "eve-reviewer",
    extensionVersion: "0.1.0",
    projectId: "sha256:project",
  } as const;
  const operationId = "operation-mapping";
  const context = {
    budget: {
      inputBytes: 1_024,
      outputBytesRemaining: 5_000_000,
      progressBytesRemaining: 1_000_000,
      progressRecordsRemaining: 256,
    },
    capabilities: {
      "adam.analyzer-execution.biome@1": {
        async analyze() {
          onAnalyze();
          return {
            execution: {
              analyzer: "biome",
              analyzerVersion,
              exitCode: 1,
              profile: "adam-biome-recommended-v1",
              provenance: { ...provenance, operationId, projectId: analyzerProjectId },
            },
            report,
          };
        },
      },
      "adam.artifact.publish@1": {
        async publish(input) {
          artifactBytes = input.bytes;
          return {
            byteCount: input.bytes.byteLength,
            contract: input.contract,
            id: "sha256:report",
            mediaType: input.mediaType,
            provenance: { ...provenance, operationId },
          };
        },
      },
      "adam.storage.records@1": {
        async create(input) {
          return {
            byteCount: 512,
            contract: input.contract,
            digest: "sha256:record",
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
    deadlineAt: "2099-01-01T00:00:00.000Z",
    diagnostics: [],
    operationId,
    provenance,
    signal: new AbortController().signal,
    async progress() {},
  } satisfies ExtensionOperationContext;

  await registration.execute(request, context);

  assert.ok(artifactBytes);
  return JSON.parse(new TextDecoder().decode(artifactBytes)) as {
    payload: {
      error?: unknown;
      partial?: { diagnostics: unknown[] };
      report?: { coverage: { status: string }; findings: unknown[] };
    };
  };
}
