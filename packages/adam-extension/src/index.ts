// biome-ignore-all lint/complexity/useLiteralKeys: Runtime validation requires indexed access to unknown record fields.
import {
  EXTENSION_ARTIFACT_CAPABILITY_ID,
  EXTENSION_BIOME_CAPABILITY_ID,
  EXTENSION_BIOME_MAX_FILE_BYTES,
  EXTENSION_BIOME_MAX_FILES,
  EXTENSION_BIOME_MAX_REPORT_BYTES,
  EXTENSION_BIOME_MAX_SNAPSHOT_BYTES,
  EXTENSION_BIOME_MAX_STDERR_BYTES,
  EXTENSION_BIOME_MAX_STDOUT_BYTES,
  EXTENSION_BIOME_PROFILE,
  EXTENSION_RECORDS_CAPABILITY_ID,
  type ExtensionActivationContext,
  type ExtensionBiomeCapability,
  type ExtensionContractCodec,
  type ExtensionContractResult,
  type ExtensionJsonValue,
  type ExtensionOperationContext,
} from "@adam-agent/extension-api";
import {
  type AnalyzeReviewInput,
  createReviewUseCase,
  type ReviewRequestEnvelope,
  reviewContractV1,
} from "@eve-reviewer/core";
import {
  analyzedBiomeOutcome,
  deterministicBiomePolicy,
  failedBiomeOutcome,
  skippedBiomeOutcome,
  supportedHeadSources,
} from "./deterministic-biome.ts";

const reportContract = { id: "eve-reviewer.review-result", version: 1 } as const;
const recordContract = { id: "eve-reviewer.operation-record", version: 1 } as const;

type RuntimeRecord = Record<string, unknown>;

class InvalidBiomeReport extends Error {}
class InvalidBiomeResponse extends Error {}

function isRecord(value: unknown): value is RuntimeRecord {
  return typeof value === "object" && value !== null;
}

function requiredCapability<T>(value: T | undefined, id: string): T {
  if (value === undefined) {
    throw new Error(`Required capability ${id} is unavailable.`);
  }
  return value;
}

function exactKeys(value: RuntimeRecord, expected: readonly string[]): boolean {
  return (
    Object.keys(value).every((key) => expected.includes(key)) &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function matchesOperationProvenance(value: unknown, operation: ExtensionOperationContext): boolean {
  return (
    isRecord(value) &&
    exactKeys(value, [
      "contributionId",
      "extensionId",
      "extensionVersion",
      "operationId",
      "projectId",
    ]) &&
    value["contributionId"] === operation.provenance.contributionId &&
    value["extensionId"] === operation.provenance.extensionId &&
    value["extensionVersion"] === operation.provenance.extensionVersion &&
    value["operationId"] === operation.operationId &&
    value["projectId"] === operation.provenance.projectId
  );
}

function matchesContract(value: unknown, expected: { id: string; version: number }): boolean {
  return (
    isRecord(value) &&
    exactKeys(value, ["id", "version"]) &&
    value["id"] === expected.id &&
    value["version"] === expected.version
  );
}

function validatedBiomeReport(
  report: unknown,
  sourcePaths: ReadonlySet<string>,
): Array<{ line: number; path: string }> {
  if (
    !isRecord(report) ||
    !exactKeys(report, ["command", "diagnostics", "summary"]) ||
    report["command"] !== "check" ||
    !Array.isArray(report["diagnostics"])
  ) {
    throw new InvalidBiomeReport("Biome returned an invalid JSON report.");
  }
  const summary = report["summary"];
  const summaryKeys = [
    "changed",
    "diagnosticsNotPrinted",
    "duration",
    "errors",
    "infos",
    "matches",
    "scannerDuration",
    "skipped",
    "suggestedFixesSkipped",
    "unchanged",
    "warnings",
  ] as const;
  if (
    !isRecord(summary) ||
    !Object.keys(summary).every((key) =>
      summaryKeys.includes(key as (typeof summaryKeys)[number]),
    ) ||
    !Object.hasOwn(summary, "errors") ||
    !Object.hasOwn(summary, "warnings") ||
    !Object.values(summary).every(isNonNegativeInteger) ||
    (summary["diagnosticsNotPrinted"] !== undefined && summary["diagnosticsNotPrinted"] !== 0) ||
    (summary["skipped"] !== undefined && summary["skipped"] !== 0)
  ) {
    throw new InvalidBiomeReport("Biome returned an invalid JSON report.");
  }
  const diagnostics: Array<{ line: number; path: string }> = [];
  for (const diagnostic of report["diagnostics"]) {
    if (
      !isRecord(diagnostic) ||
      !exactKeys(diagnostic, ["severity", "message", "category", "location", "advices"]) ||
      (diagnostic["severity"] !== "error" &&
        diagnostic["severity"] !== "warning" &&
        diagnostic["severity"] !== "info") ||
      typeof diagnostic["message"] !== "string" ||
      diagnostic["message"].length === 0 ||
      typeof diagnostic["category"] !== "string" ||
      diagnostic["category"].length === 0 ||
      !Array.isArray(diagnostic["advices"])
    ) {
      throw new InvalidBiomeReport("Biome returned an invalid diagnostic.");
    }
    const location = diagnostic["location"];
    if (!isRecord(location) || !exactKeys(location, ["path", "start", "end"])) {
      throw new InvalidBiomeReport("Biome returned an invalid diagnostic location.");
    }
    const start = location["start"];
    const end = location["end"];
    const path = location["path"];
    if (
      typeof path !== "string" ||
      path.length === 0 ||
      !isRecord(start) ||
      !exactKeys(start, ["line", "column"]) ||
      !isPositiveInteger(start["line"]) ||
      !isPositiveInteger(start["column"]) ||
      !isRecord(end) ||
      !exactKeys(end, ["line", "column"]) ||
      !isPositiveInteger(end["line"]) ||
      !isPositiveInteger(end["column"])
    ) {
      throw new InvalidBiomeReport("Biome returned an invalid diagnostic location.");
    }
    if (diagnostic["category"] === deterministicBiomePolicy.rule) {
      if (!sourcePaths.has(path)) {
        throw new InvalidBiomeReport("Biome returned an invalid diagnostic location.");
      }
      diagnostics.push({ path, line: start["line"] });
    }
  }
  return diagnostics;
}

function validatedBiomeResponse(
  value: unknown,
  operation: ExtensionOperationContext,
  sourcePaths: ReadonlySet<string>,
) {
  if (!isRecord(value) || !exactKeys(value, ["execution", "report"])) {
    throw new InvalidBiomeResponse("Biome returned an invalid response.");
  }
  const execution = value["execution"];
  if (
    !isRecord(execution) ||
    !exactKeys(execution, ["analyzer", "analyzerVersion", "exitCode", "profile", "provenance"]) ||
    execution["analyzer"] !== "biome" ||
    execution["analyzerVersion"] !== deterministicBiomePolicy.version ||
    (execution["exitCode"] !== 0 && execution["exitCode"] !== 1) ||
    execution["profile"] !== deterministicBiomePolicy.profile
  ) {
    throw new InvalidBiomeResponse("Biome returned invalid execution provenance.");
  }
  if (!matchesOperationProvenance(execution["provenance"], operation)) {
    throw new InvalidBiomeResponse("Biome returned invalid operation provenance.");
  }
  return validatedBiomeReport(value["report"], sourcePaths);
}

function validatedArtifactSummary(
  value: unknown,
  operation: ExtensionOperationContext,
  expectedByteCount: number,
) {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["byteCount", "contract", "id", "mediaType", "provenance"]) ||
    value["byteCount"] !== expectedByteCount ||
    !matchesContract(value["contract"], reportContract) ||
    typeof value["id"] !== "string" ||
    value["id"].length === 0 ||
    value["mediaType"] !== "application/json" ||
    !matchesOperationProvenance(value["provenance"], operation)
  ) {
    throw new Error("Adam returned an invalid artifact summary.");
  }
  return {
    contract: reportContract,
    id: value["id"],
  } as const;
}

function validatedRecordSummary(
  value: unknown,
  operation: ExtensionOperationContext,
  expectedKey: string,
) {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["byteCount", "contract", "digest", "key", "provenance"]) ||
    !isNonNegativeInteger(value["byteCount"]) ||
    !matchesContract(value["contract"], recordContract) ||
    typeof value["digest"] !== "string" ||
    value["digest"].length === 0 ||
    value["key"] !== expectedKey ||
    !matchesOperationProvenance(value["provenance"], operation)
  ) {
    throw new Error("Adam returned an invalid record summary.");
  }
  return {
    contract: recordContract,
    digest: value["digest"],
    key: expectedKey,
  } as const;
}

async function analyzeWithBiome(input: AnalyzeReviewInput, operation: ExtensionOperationContext) {
  const sources = supportedHeadSources(input);
  if (sources.length === 0) {
    return [skippedBiomeOutcome(input)];
  }
  const biome = requiredCapability<ExtensionBiomeCapability>(
    operation.capabilities[EXTENSION_BIOME_CAPABILITY_ID],
    EXTENSION_BIOME_CAPABILITY_ID,
  );
  const analysis: unknown = await biome.analyze({
    files: sources,
    profile: EXTENSION_BIOME_PROFILE,
  });
  try {
    const diagnostics = validatedBiomeResponse(
      analysis,
      operation,
      new Set(sources.map((source) => source.path)),
    );
    return [analyzedBiomeOutcome(input, sources, diagnostics)];
  } catch (error) {
    if (error instanceof InvalidBiomeResponse) {
      return [failedBiomeOutcome(input, "The Biome broker returned an invalid response.")];
    }
    if (!(error instanceof InvalidBiomeReport)) {
      throw error;
    }
    return [failedBiomeOutcome(input, "The Biome broker returned an invalid report.")];
  }
}

async function executeReview(request: unknown, operation: ExtensionOperationContext) {
  await operation.progress({
    kind: "eve-reviewer.review-progress",
    schemaVersion: 1,
    payload: { stage: "analyzing" },
  });
  const review = createReviewUseCase({
    analyze: (input) => analyzeWithBiome(input, operation),
    clock: Date.now,
  });
  const result = await review.review(request, {
    signal: operation.signal,
    deadline: Date.parse(operation.deadlineAt),
    limits: {
      maximumSourceFiles: EXTENSION_BIOME_MAX_FILES,
      maximumSourceFileBytes: EXTENSION_BIOME_MAX_FILE_BYTES,
      maximumSnapshotBytes: EXTENSION_BIOME_MAX_SNAPSHOT_BYTES,
      maximumStdoutBytes: EXTENSION_BIOME_MAX_STDOUT_BYTES,
      maximumStderrBytes: EXTENSION_BIOME_MAX_STDERR_BYTES,
      maximumReportBytes: EXTENSION_BIOME_MAX_REPORT_BYTES,
      terminationGraceMilliseconds: 1_000,
    },
  });
  const encoded = reviewContractV1.encodeResult(result);
  if (!encoded.ok) {
    throw new Error("Eve produced an invalid review result.");
  }
  const resultValue = JSON.parse(encoded.value) as ExtensionJsonValue;
  await operation.progress({
    kind: "eve-reviewer.review-progress",
    schemaVersion: 1,
    payload: { stage: "publishing" },
  });
  const artifacts = requiredCapability(
    operation.capabilities[EXTENSION_ARTIFACT_CAPABILITY_ID],
    EXTENSION_ARTIFACT_CAPABILITY_ID,
  );
  const artifactBytes = new TextEncoder().encode(encoded.value);
  const artifactReference = validatedArtifactSummary(
    await artifacts.publish({
      bytes: artifactBytes,
      contract: reportContract,
      mediaType: "application/json",
    }),
    operation,
    artifactBytes.byteLength,
  );
  const records = requiredCapability(
    operation.capabilities[EXTENSION_RECORDS_CAPABILITY_ID],
    EXTENSION_RECORDS_CAPABILITY_ID,
  );
  const recordKey = `operations/${operation.operationId}`;
  const record = validatedRecordSummary(
    await records.create({
      key: recordKey,
      contract: recordContract,
      value: {
        kind: "eve-reviewer.operation-record",
        schemaVersion: 1,
        artifact: artifactReference,
        result: resultValue,
      },
    }),
    operation,
    recordKey,
  );
  const summary = result.payload.ok
    ? {
        coverage: result.payload.report.coverage.status,
        findings: result.payload.report.findings.length,
        risk: result.payload.report.risk,
      }
    : { error: result.payload.error.code };
  return {
    kind: "eve-reviewer.operation-result",
    schemaVersion: 1,
    payload: {
      ok: result.payload.ok,
      artifact: artifactReference,
      record,
      summary,
    },
  };
}

function decodeOperationResult(value: unknown): ExtensionContractResult<ExtensionJsonValue> {
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: "/", code: "object" }] };
  }
  for (const key of Object.keys(value)) {
    if (key !== "kind" && key !== "schemaVersion" && key !== "payload") {
      return { ok: false, issues: [{ path: `/${key}`, code: "unknown-field" }] };
    }
  }
  if (value["kind"] !== "eve-reviewer.operation-result") {
    return { ok: false, issues: [{ path: "/kind", code: "literal" }] };
  }
  if (value["schemaVersion"] !== 1) {
    return { ok: false, issues: [{ path: "/schemaVersion", code: "literal" }] };
  }
  const payload = value["payload"];
  if (!isRecord(payload)) {
    return { ok: false, issues: [{ path: "/payload", code: "object" }] };
  }
  for (const key of Object.keys(payload)) {
    if (key !== "ok" && key !== "artifact" && key !== "record" && key !== "summary") {
      return { ok: false, issues: [{ path: `/payload/${key}`, code: "unknown-field" }] };
    }
  }
  if (typeof payload["ok"] !== "boolean") {
    return { ok: false, issues: [{ path: "/payload/ok", code: "boolean" }] };
  }
  const artifact = payload["artifact"];
  if (!isRecord(artifact)) {
    return { ok: false, issues: [{ path: "/payload/artifact", code: "object" }] };
  }
  for (const key of Object.keys(artifact)) {
    if (key !== "id" && key !== "contract") {
      return {
        ok: false,
        issues: [{ path: `/payload/artifact/${key}`, code: "unknown-field" }],
      };
    }
  }
  if (typeof artifact["id"] !== "string" || artifact["id"].length === 0) {
    return { ok: false, issues: [{ path: "/payload/artifact/id", code: "string" }] };
  }
  const artifactContract = artifact["contract"];
  if (!isRecord(artifactContract)) {
    return { ok: false, issues: [{ path: "/payload/artifact/contract", code: "object" }] };
  }
  for (const key of Object.keys(artifactContract)) {
    if (key !== "id" && key !== "version") {
      return {
        ok: false,
        issues: [{ path: `/payload/artifact/contract/${key}`, code: "unknown-field" }],
      };
    }
  }
  if (artifactContract["id"] !== reportContract.id) {
    return {
      ok: false,
      issues: [{ path: "/payload/artifact/contract/id", code: "literal" }],
    };
  }
  if (artifactContract["version"] !== reportContract.version) {
    return {
      ok: false,
      issues: [{ path: "/payload/artifact/contract/version", code: "literal" }],
    };
  }
  const record = payload["record"];
  if (!isRecord(record)) {
    return { ok: false, issues: [{ path: "/payload/record", code: "object" }] };
  }
  for (const key of Object.keys(record)) {
    if (key !== "key" && key !== "digest" && key !== "contract") {
      return {
        ok: false,
        issues: [{ path: `/payload/record/${key}`, code: "unknown-field" }],
      };
    }
  }
  for (const key of ["key", "digest"] as const) {
    if (typeof record[key] !== "string" || record[key].length === 0) {
      return { ok: false, issues: [{ path: `/payload/record/${key}`, code: "string" }] };
    }
  }
  const operationRecordContract = record["contract"];
  if (!isRecord(operationRecordContract)) {
    return { ok: false, issues: [{ path: "/payload/record/contract", code: "object" }] };
  }
  for (const key of Object.keys(operationRecordContract)) {
    if (key !== "id" && key !== "version") {
      return {
        ok: false,
        issues: [{ path: `/payload/record/contract/${key}`, code: "unknown-field" }],
      };
    }
  }
  if (operationRecordContract["id"] !== recordContract.id) {
    return {
      ok: false,
      issues: [{ path: "/payload/record/contract/id", code: "literal" }],
    };
  }
  if (operationRecordContract["version"] !== recordContract.version) {
    return {
      ok: false,
      issues: [{ path: "/payload/record/contract/version", code: "literal" }],
    };
  }
  const summary = payload["summary"];
  if (!isRecord(summary)) {
    return { ok: false, issues: [{ path: "/payload/summary", code: "object" }] };
  }
  if (payload["ok"]) {
    for (const key of Object.keys(summary)) {
      if (key !== "coverage" && key !== "findings" && key !== "risk") {
        return {
          ok: false,
          issues: [{ path: `/payload/summary/${key}`, code: "unknown-field" }],
        };
      }
    }
    if (
      summary["coverage"] !== "complete" &&
      summary["coverage"] !== "partial" &&
      summary["coverage"] !== "no-coverage"
    ) {
      return { ok: false, issues: [{ path: "/payload/summary/coverage", code: "enum" }] };
    }
    if (!Number.isSafeInteger(summary["findings"]) || Number(summary["findings"]) < 0) {
      return { ok: false, issues: [{ path: "/payload/summary/findings", code: "integer" }] };
    }
    if (
      summary["risk"] !== "none" &&
      summary["risk"] !== "low" &&
      summary["risk"] !== "medium" &&
      summary["risk"] !== "high" &&
      summary["risk"] !== "critical"
    ) {
      return { ok: false, issues: [{ path: "/payload/summary/risk", code: "enum" }] };
    }
  } else {
    for (const key of Object.keys(summary)) {
      if (key !== "error") {
        return {
          ok: false,
          issues: [{ path: `/payload/summary/${key}`, code: "unknown-field" }],
        };
      }
    }
    if (typeof summary["error"] !== "string" || summary["error"].length === 0) {
      return { ok: false, issues: [{ path: "/payload/summary/error", code: "string" }] };
    }
  }
  return { ok: true, value: value as ExtensionJsonValue };
}

const operationResultCodec: ExtensionContractCodec<ExtensionJsonValue> = {
  id: "eve-reviewer.operation-result",
  version: 1,
  decode: decodeOperationResult,
  encode: decodeOperationResult,
};

function decodeReviewProgress(value: unknown): ExtensionContractResult<ExtensionJsonValue> {
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: "/", code: "object" }] };
  }
  for (const key of Object.keys(value)) {
    if (key !== "kind" && key !== "schemaVersion" && key !== "payload") {
      return { ok: false, issues: [{ path: `/${key}`, code: "unknown-field" }] };
    }
  }
  if (value["kind"] !== "eve-reviewer.review-progress") {
    return { ok: false, issues: [{ path: "/kind", code: "literal" }] };
  }
  if (value["schemaVersion"] !== 1) {
    return { ok: false, issues: [{ path: "/schemaVersion", code: "literal" }] };
  }
  const payload = value["payload"];
  if (!isRecord(payload)) {
    return { ok: false, issues: [{ path: "/payload", code: "object" }] };
  }
  for (const key of Object.keys(payload)) {
    if (key !== "stage") {
      return { ok: false, issues: [{ path: `/payload/${key}`, code: "unknown-field" }] };
    }
  }
  if (payload["stage"] !== "analyzing" && payload["stage"] !== "publishing") {
    return { ok: false, issues: [{ path: "/payload/stage", code: "enum" }] };
  }
  return { ok: true, value: value as ExtensionJsonValue };
}

const reviewProgressCodec: ExtensionContractCodec<ExtensionJsonValue> = {
  id: "eve-reviewer.review-progress",
  version: 1,
  decode: decodeReviewProgress,
  encode: decodeReviewProgress,
};

const reviewRequestCodec: ExtensionContractCodec<ReviewRequestEnvelope> = {
  id: "eve-reviewer.review-request",
  version: 1,
  decode(value) {
    const decoded = reviewContractV1.decodeRequest(value);
    return decoded.ok ? decoded : { ok: false, issues: decoded.error.issues };
  },
  encode(value) {
    const decoded = reviewContractV1.decodeRequest(value);
    return decoded.ok
      ? { ok: true, value: decoded.value }
      : { ok: false, issues: decoded.error.issues };
  },
};

export function activate(context: ExtensionActivationContext): void {
  context.registerOperation({
    id: "eve-reviewer.review@1",
    input: reviewRequestCodec,
    output: operationResultCodec,
    progress: reviewProgressCodec,
    execute: executeReview,
  });
}
