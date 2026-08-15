import type {
  AnalyzeReview,
  AnalyzeReviewInput,
  AnalyzerDescriptor,
  AnalyzerExecutionResult,
  AnalyzerExecutionSuccess,
  CandidateFinding,
  ExecuteAnalyzer,
  ParsedDiff,
  SourceSnapshotFile,
} from "@eve-reviewer/core";

const analyzerProfile = "deterministic-security";
const analyzerRule = "lint/security/noGlobalEval";
const analyzerVersion = "2.5.8";
const supportedSourceExtensions = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"];

interface SarifResult {
  ruleId?: unknown;
  locations?: Array<{
    physicalLocation?: {
      artifactLocation?: { uri?: unknown };
      region?: { startLine?: unknown };
    };
  }>;
}

interface SarifLog {
  version?: unknown;
  runs?: Array<{ results?: SarifResult[] }>;
}

class OutOfProfileDiagnostic extends Error {}

type FileOutcome =
  | { side: "old" | "new"; path: string; status: "analyzed" }
  | {
      side: "old" | "new";
      path: string;
      status: "skipped";
      reason: "binary" | "deleted" | "metadata-only" | "source-unavailable" | "unsupported";
    };

type RuntimeRecord = Record<string, unknown> & {
  cleanupIncomplete?: unknown;
  version?: unknown;
  ok?: unknown;
  exitCode?: unknown;
  stdout?: unknown;
  stderr?: unknown;
  report?: unknown;
  artifacts?: unknown;
  failure?: unknown;
  message?: unknown;
  resource?: unknown;
  uri?: unknown;
  path?: unknown;
  runs?: unknown;
  results?: unknown;
};

function isRecord(value: unknown): value is RuntimeRecord {
  return typeof value === "object" && value !== null;
}

function isAnalyzerExecutionResult(value: unknown): value is AnalyzerExecutionResult {
  if (!isRecord(value) || typeof value.version !== "string") {
    return false;
  }
  if (value.cleanupIncomplete !== undefined && value.cleanupIncomplete !== true) {
    return false;
  }
  if (value.ok === true) {
    return (
      (value.exitCode === 0 || value.exitCode === 1) &&
      typeof value.stdout === "string" &&
      typeof value.stderr === "string" &&
      typeof value.report === "string" &&
      (value.artifacts === undefined ||
        (Array.isArray(value.artifacts) &&
          value.artifacts.every(
            (artifact) =>
              isRecord(artifact) &&
              typeof artifact.uri === "string" &&
              typeof artifact.path === "string",
          )))
    );
  }
  if (value.ok !== false || typeof value.failure !== "string") {
    return false;
  }
  switch (value.failure) {
    case "start":
      return typeof value.message === "string";
    case "execution":
      return (
        typeof value.message === "string" &&
        (value.exitCode === null || Number.isSafeInteger(value.exitCode))
      );
    case "cancelled":
    case "deadline":
    case "cleanup":
      return true;
    case "limit":
      return (
        value.resource === "stdout" || value.resource === "stderr" || value.resource === "report"
      );
    default:
      return false;
  }
}

function isSarifLog(value: unknown): value is SarifLog {
  if (!isRecord(value) || value.version !== "2.1.0" || !Array.isArray(value.runs)) {
    return false;
  }
  return value.runs.every(
    (run) =>
      isRecord(run) &&
      (run.results === undefined ||
        (Array.isArray(run.results) && run.results.every((result) => isRecord(result)))),
  );
}

function analyzerDescriptor(): AnalyzerDescriptor {
  return {
    tool: "biome",
    version: analyzerVersion,
    profile: analyzerProfile,
    rules: [analyzerRule],
  };
}

function supportedHeadSources(input: AnalyzeReviewInput): SourceSnapshotFile[] {
  const changedPaths = new Set(
    input.diff.files.flatMap((file) =>
      file.lines
        .filter((line) => line.changed && line.location.side === "new")
        .map((line) => line.location.path),
    ),
  );
  return input.sources.head
    .filter(
      (source) =>
        changedPaths.has(source.path) &&
        supportedSourceExtensions.some((extension) =>
          source.path.toLowerCase().endsWith(extension),
        ),
    )
    .toSorted((left, right) => left.path.localeCompare(right.path));
}

function fileOutcomes(input: AnalyzeReviewInput, analyzedPaths: Set<string>): FileOutcome[] {
  const availableHeadPaths = new Set(input.sources.head.map((source) => source.path));
  return input.diff.files.flatMap<FileOutcome>((file) => {
    const path = file.newPath ?? file.oldPath;
    const side = file.newPath === null ? ("old" as const) : ("new" as const);
    if (path === null) {
      return [];
    }
    if (analyzedPaths.has(path)) {
      return [{ side, path, status: "analyzed" as const }];
    }
    const reason =
      file.status === "binary"
        ? ("binary" as const)
        : file.status === "deleted"
          ? ("deleted" as const)
          : file.status === "metadata-only" || !file.lines.some((line) => line.changed)
            ? ("metadata-only" as const)
            : file.newPath !== null && !availableHeadPaths.has(file.newPath)
              ? ("source-unavailable" as const)
              : ("unsupported" as const);
    return [{ side, path, status: "skipped" as const, reason }];
  });
}

function failedFileOutcomes(input: AnalyzeReviewInput) {
  return input.diff.files.flatMap((file) => {
    const path = file.newPath ?? file.oldPath;
    return path === null
      ? []
      : [
          {
            side: file.newPath === null ? ("old" as const) : ("new" as const),
            path,
            status: "failed" as const,
          },
        ];
  });
}

function failedOutcome(input: AnalyzeReviewInput, diagnostic: Record<string, unknown>) {
  return [
    {
      kind: "eve-reviewer.analyzer-outcome",
      schemaVersion: 1,
      payload: {
        analyzer: analyzerDescriptor(),
        status: "failed",
        files: failedFileOutcomes(input),
        diagnostic,
      },
    },
  ];
}

function diagnosticForExecution(execution: Exclude<AnalyzerExecutionResult, { ok: true }>) {
  const cleanup =
    "cleanupIncomplete" in execution && execution.cleanupIncomplete
      ? { cleanupIncomplete: true as const }
      : {};
  switch (execution.failure) {
    case "start":
      return {
        code: "analyzer-start-failed",
        message: "Unable to start the Biome analyzer.",
        ...cleanup,
      };
    case "execution":
      return {
        code: "analyzer-execution-failed",
        message: "The Biome analyzer did not complete successfully.",
        ...cleanup,
      };
    case "cleanup":
      return {
        code: "analyzer-cleanup-failed",
        message: "The Biome analyzer could not clean up its temporary resources.",
      };
    case "limit":
      return {
        code: "analyzer-limit-exceeded",
        message: `The Biome analyzer exceeded the configured ${execution.resource} limit.`,
        resource: execution.resource,
        ...cleanup,
      };
    case "cancelled":
      return {
        code: "cancelled",
        message: "The Biome analyzer was cancelled during analysis.",
        ...cleanup,
      };
    case "deadline":
      return {
        code: "deadline-exceeded",
        message: "The Biome analyzer deadline elapsed during analysis.",
        ...cleanup,
      };
  }
}

function candidatesFromSarif(
  report: SarifLog,
  execution: AnalyzerExecutionSuccess,
  diff: ParsedDiff,
): CandidateFinding[] {
  const artifactPaths = new Map(
    (execution.artifacts ?? []).map((artifact) => [artifact.uri, artifact.path]),
  );
  const changedLocations = new Set(
    diff.files.flatMap((file) =>
      file.lines
        .filter((line) => line.changed && line.location.side === "new")
        .map((line) => `${line.location.path}\0${String(line.location.line)}`),
    ),
  );
  const candidates: CandidateFinding[] = [];
  for (const run of report.runs ?? []) {
    for (const result of run.results ?? []) {
      if (typeof result.ruleId !== "string") {
        throw new Error("Biome SARIF contains a diagnostic without a rule identifier.");
      }
      if (result.ruleId !== analyzerRule) {
        throw new OutOfProfileDiagnostic();
      }
      const location = result.locations?.[0]?.physicalLocation;
      const uri = location?.artifactLocation?.uri;
      const line = location?.region?.startLine;
      if (typeof uri !== "string" || !Number.isSafeInteger(line) || Number(line) <= 0) {
        throw new Error("Biome SARIF contains an invalid finding location.");
      }
      const path = artifactPaths.get(uri);
      if (path === undefined) {
        throw new Error("Biome SARIF references a file outside the snapshot.");
      }
      const findingLine = Number(line);
      if (!changedLocations.has(`${path}\0${String(findingLine)}`)) {
        continue;
      }
      candidates.push({
        ruleId: "security/no-dynamic-eval",
        severity: "critical",
        title: "Dynamic code evaluation",
        explanation: "Code added by the change evaluates text as executable code.",
        location: { side: "new", path, line: findingLine },
        fixGuidance: "Replace eval with an explicit parser or an allow-listed operation map.",
        suggestedTests: "Exercise hostile and malformed input and assert it is never executed.",
        confidence: 0.95,
        provenance: {
          tool: "biome",
          version: analyzerVersion,
          ruleId: analyzerRule,
        },
      });
    }
  }
  return candidates;
}

export function createDeterministicAnalyze(dependencies: {
  executeAnalyzer: ExecuteAnalyzer;
}): AnalyzeReview {
  return async (input, context) => {
    const sources = supportedHeadSources(input);
    let execution: unknown;
    try {
      execution = await dependencies.executeAnalyzer(
        {
          profile: analyzerProfile,
          rules: [analyzerRule],
          sources,
        },
        context,
      );
    } catch {
      return failedOutcome(input, {
        code: "analyzer-execution-failed",
        message: "The analyzer Adapter did not complete successfully.",
      });
    }
    if (!isAnalyzerExecutionResult(execution)) {
      return failedOutcome(input, {
        code: "invalid-analyzer-output",
        message: "The analyzer Adapter returned an invalid result.",
      });
    }
    if (execution.version !== analyzerVersion) {
      return failedOutcome(input, {
        code: "invalid-analyzer-output",
        message: "The analyzer provenance did not match the deterministic review profile.",
      });
    }
    if (execution.ok && (execution as unknown as RuntimeRecord).cleanupIncomplete === true) {
      return failedOutcome(input, {
        code: "analyzer-cleanup-failed",
        message: "The Biome analyzer could not clean up its temporary resources.",
      });
    }
    if (!execution.ok) {
      return failedOutcome(input, diagnosticForExecution(execution));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(execution.report) as SarifLog;
    } catch {
      return failedOutcome(input, {
        code: "invalid-analyzer-output",
        message: "The Biome analyzer returned invalid SARIF output.",
      });
    }
    if (!isSarifLog(parsed)) {
      return failedOutcome(input, {
        code: "invalid-analyzer-output",
        message: "The Biome analyzer returned invalid SARIF output.",
      });
    }
    const analyzedPaths = new Set(sources.map((source) => source.path));
    let candidates: CandidateFinding[];
    try {
      candidates = candidatesFromSarif(parsed, execution, input.diff);
    } catch (error) {
      return failedOutcome(
        input,
        error instanceof OutOfProfileDiagnostic
          ? {
              code: "analyzer-diagnostic",
              message: "Biome reported a diagnostic outside the deterministic review profile.",
            }
          : {
              code: "invalid-analyzer-output",
              message: "The Biome analyzer returned invalid SARIF output.",
            },
      );
    }
    const files = fileOutcomes(input, analyzedPaths);
    return files.some((file) => file.status === "analyzed")
      ? [
          {
            kind: "eve-reviewer.analyzer-outcome",
            schemaVersion: 1,
            payload: {
              analyzer: analyzerDescriptor(),
              status: "analyzed",
              files,
              candidates,
            },
          },
        ]
      : [
          {
            kind: "eve-reviewer.analyzer-outcome",
            schemaVersion: 1,
            payload: {
              analyzer: analyzerDescriptor(),
              status: "skipped",
              files,
            },
          },
        ];
  };
}
