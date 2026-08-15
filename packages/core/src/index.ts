import {
  type ChangedFile,
  type ChangedFileStatus,
  type DiffSide,
  type EvidenceLocation,
  type ParsedDiff,
  parseUnifiedDiff,
} from "./unified-diff.ts";

export {
  type ChangedFile,
  type ChangedFileStatus,
  type DiffLine,
  type DiffSide,
  type EvidenceLocation,
  MAX_DIFF_BYTES,
  type ParsedDiff,
  parseUnifiedDiff,
} from "./unified-diff.ts";

export type Severity = "critical" | "high" | "medium" | "low";

export interface AnalyzerProvenance {
  tool: string;
  version: string;
  ruleId: string;
}

export interface AnalyzerDescriptor {
  tool: string;
  version: string;
  profile: string;
  rules: string[];
}

export interface AnalyzerLimits {
  maximumSourceFiles: number;
  maximumSourceFileBytes: number;
  maximumSnapshotBytes: number;
  maximumStdoutBytes: number;
  maximumStderrBytes: number;
  maximumReportBytes: number;
  terminationGraceMilliseconds: number;
}

export interface AnalyzerContext {
  signal: AbortSignal;
  deadline: number;
  limits: AnalyzerLimits;
}

export interface CandidateFinding {
  ruleId: string;
  severity: Severity;
  title: string;
  explanation: string;
  location: EvidenceLocation;
  fixGuidance: string;
  suggestedTests: string;
  confidence: number;
  provenance: AnalyzerProvenance;
}

export interface SourceSnapshotFile {
  path: string;
  content: string;
}

export interface ReviewSources {
  base: SourceSnapshotFile[];
  head: SourceSnapshotFile[];
}

export interface AnalyzedFile {
  side: DiffSide;
  path: string;
}

export interface ReviewFinding extends CandidateFinding {
  evidence: string;
}

export type SourceAvailability = "available" | "unavailable" | "not-applicable";

export type FileAnalysisCoverage =
  | { status: "analyzed"; side: DiffSide }
  | {
      status: "not-analyzed";
      reason: "binary" | "deleted" | "metadata-only" | "source-unavailable" | "unsupported";
    };

export interface FileCoverage {
  oldPath: string | null;
  newPath: string | null;
  status: ChangedFileStatus;
  baseSource: SourceAvailability;
  headSource: SourceAvailability;
  analysis: FileAnalysisCoverage;
}

export type ReportCoverageStatus = "complete" | "partial" | "no-coverage";

export interface ReviewCoverage {
  status: ReportCoverageStatus;
  files: FileCoverage[];
}

export interface ValidatedReportInput {
  repository: string;
  pullRequest: number | null;
  reviewer: string;
  diff: string;
  sources: ReviewSources;
  analyzedFiles: AnalyzedFile[];
  candidates: CandidateFinding[];
}

export interface ReviewReport {
  repository: string;
  pullRequest: number | null;
  summary: string;
  risk: Severity | "none";
  coverage: ReviewCoverage;
  reviewer: string;
  findings: ReviewFinding[];
}

export interface DeterministicReviewReport extends ReviewReport {
  analyzer: AnalyzerDescriptor;
}

export interface DeterministicReviewInput {
  repository: string;
  pullRequest: number | null;
  reviewer: string;
  diff: ParsedDiff;
  sources: ReviewSources;
}

export interface AnalyzerExecutionInput {
  profile: string;
  rules: string[];
  sources: SourceSnapshotFile[];
}

export interface AnalyzerExecutionSuccess {
  ok: true;
  version: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  artifacts?: Array<{ uri: string; path: string }>;
  report: string;
}

export interface AnalyzerExecutionStartFailure {
  ok: false;
  failure: "start";
  version: string;
  message: string;
  cleanupIncomplete?: true;
}

export interface AnalyzerExecutionFailure {
  ok: false;
  failure: "execution";
  version: string;
  exitCode: number | null;
  message: string;
  cleanupIncomplete?: true;
}

export interface AnalyzerExecutionCancellation {
  ok: false;
  failure: "cancelled";
  version: string;
  cleanupIncomplete?: true;
}

export interface AnalyzerExecutionDeadline {
  ok: false;
  failure: "deadline";
  version: string;
  cleanupIncomplete?: true;
}

export interface AnalyzerExecutionCleanupFailure {
  ok: false;
  failure: "cleanup";
  version: string;
}

export type AnalyzerLimitedResource = "stdout" | "stderr" | "report";

export interface AnalyzerExecutionLimitFailure {
  ok: false;
  failure: "limit";
  resource: AnalyzerLimitedResource;
  version: string;
  cleanupIncomplete?: true;
}

export type AnalyzerExecutionResult =
  | AnalyzerExecutionSuccess
  | AnalyzerExecutionStartFailure
  | AnalyzerExecutionFailure
  | AnalyzerExecutionCancellation
  | AnalyzerExecutionDeadline
  | AnalyzerExecutionCleanupFailure
  | AnalyzerExecutionLimitFailure;

export type ExecuteAnalyzer = (
  input: AnalyzerExecutionInput,
  context: AnalyzerContext,
) => Promise<AnalyzerExecutionResult>;

export type DeterministicReviewResult =
  | { ok: true; report: DeterministicReviewReport }
  | Exclude<ValidatedReportResult, { ok: true }>
  | {
      ok: false;
      error: {
        code: "analyzer-diagnostic";
        stage: "analyze";
        message: string;
        analyzer: AnalyzerDescriptor;
      };
    }
  | {
      ok: false;
      error: {
        code: "analyzer-start-failed";
        stage: "start";
        message: string;
        analyzer: AnalyzerDescriptor;
        cleanupIncomplete?: true;
      };
    }
  | {
      ok: false;
      error: {
        code: "analyzer-execution-failed";
        stage: "execute";
        message: string;
        analyzer: AnalyzerDescriptor;
        cleanupIncomplete?: true;
      };
    }
  | {
      ok: false;
      error: {
        code: "invalid-analyzer-output";
        stage: "validate-output";
        message: string;
        analyzer: AnalyzerDescriptor;
      };
    }
  | {
      ok: false;
      error: {
        code: "analyzer-cleanup-failed";
        stage: "cleanup";
        message: string;
        analyzer: AnalyzerDescriptor;
      };
    }
  | {
      ok: false;
      error: {
        code: "analyzer-limit-exceeded";
        stage: "execute";
        resource: AnalyzerLimitedResource;
        message: string;
        analyzer: AnalyzerDescriptor;
        cleanupIncomplete?: true;
      };
    }
  | {
      ok: false;
      error: {
        code: "cancelled";
        stage: "start" | "execute";
        message: string;
        analyzer: AnalyzerDescriptor;
        cleanupIncomplete?: true;
      };
    }
  | {
      ok: false;
      error: {
        code: "deadline-exceeded";
        stage: "start" | "execute";
        message: string;
        analyzer: AnalyzerDescriptor;
        cleanupIncomplete?: true;
      };
    };

export type ValidatedReportResult =
  | { ok: true; report: ReviewReport }
  | { ok: false; error: { code: "invalid-diff"; message: string } }
  | { ok: false; error: { code: "invalid-source"; message: string } }
  | {
      ok: false;
      error: {
        code: "source-unavailable" | "source-mismatch";
        message: string;
        source: EvidenceLocation;
      };
    }
  | {
      ok: false;
      error: {
        code: "invalid-evidence-location";
        message: string;
        finding: Pick<CandidateFinding, "ruleId" | "location">;
      };
    };

function highestSeverity(candidates: CandidateFinding[]): Severity | "none" {
  const severityOrder: Array<Severity | "none"> = ["none", "low", "medium", "high", "critical"];
  let highest: Severity | "none" = "none";

  for (const candidate of candidates) {
    if (severityOrder.indexOf(candidate.severity) > severityOrder.indexOf(highest)) {
      highest = candidate.severity;
    }
  }

  return highest;
}

function locationKey(location: Pick<EvidenceLocation, "side" | "path" | "line">): string {
  return `${location.side}\0${location.path}\0${String(location.line)}`;
}

function sourceKey(side: DiffSide, path: string): string {
  return `${side}\0${path}`;
}

type SourceMapResult =
  | { ok: true; sources: Map<string, string[]> }
  | { ok: false; error: { code: "invalid-source"; message: string } };

const MAX_SOURCE_FILE_BYTES = 1_000_000;
const MAX_SOURCE_FILES = 100;
const MAX_SOURCE_SNAPSHOT_BYTES = 5_000_000;

function sourceMap(
  sources: ReviewSources,
  files: ChangedFile[],
  limits: {
    maximumSourceFiles: number;
    maximumSourceFileBytes: number;
    maximumSnapshotBytes: number;
  } = {
    maximumSourceFiles: MAX_SOURCE_FILES,
    maximumSourceFileBytes: MAX_SOURCE_FILE_BYTES,
    maximumSnapshotBytes: MAX_SOURCE_SNAPSHOT_BYTES,
  },
): SourceMapResult {
  const result = new Map<string, string[]>();
  const oldPaths = new Set(files.flatMap((file) => (file.oldPath === null ? [] : [file.oldPath])));
  const newPaths = new Set(files.flatMap((file) => (file.newPath === null ? [] : [file.newPath])));
  for (const [label, side, snapshot, changedPaths] of [
    ["Base", "old", sources.base, oldPaths],
    ["Head", "new", sources.head, newPaths],
  ] as const) {
    if (snapshot.length > limits.maximumSourceFiles) {
      return {
        ok: false,
        error: {
          code: "invalid-source",
          message: `${label} source snapshot exceeds the ${limits.maximumSourceFiles}-file limit.`,
        },
      };
    }
    let aggregateBytes = 0;
    for (const source of snapshot) {
      if (!changedPaths.has(source.path)) {
        return {
          ok: false,
          error: {
            code: "invalid-source",
            message: `${label} source path is not present on the ${side} side of the change: ${source.path}.`,
          },
        };
      }
      const sourceBytes = Buffer.byteLength(source.content, "utf8");
      if (sourceBytes > limits.maximumSourceFileBytes) {
        return {
          ok: false,
          error: {
            code: "invalid-source",
            message: `${label} source file exceeds the ${limits.maximumSourceFileBytes}-byte limit: ${source.path}.`,
          },
        };
      }
      aggregateBytes += sourceBytes;
      if (aggregateBytes > limits.maximumSnapshotBytes) {
        return {
          ok: false,
          error: {
            code: "invalid-source",
            message: `${label} source snapshot exceeds the ${limits.maximumSnapshotBytes}-byte aggregate limit.`,
          },
        };
      }
      const key = sourceKey(side, source.path);
      if (result.has(key)) {
        return {
          ok: false,
          error: {
            code: "invalid-source",
            message: `${label} source snapshot contains duplicate path: ${source.path}.`,
          },
        };
      }
      result.set(key, source.content.split(/\r?\n/));
    }
  }
  return { ok: true, sources: result };
}

function pathForSide(file: ChangedFile, side: DiffSide): string | null {
  return side === "old" ? file.oldPath : file.newPath;
}

function availability(
  path: string | null,
  side: DiffSide,
  sources: Map<string, string[]>,
): SourceAvailability {
  if (path === null) {
    return "not-applicable";
  }
  return sources.has(sourceKey(side, path)) ? "available" : "unavailable";
}

function coverageForFile(
  file: ChangedFile,
  sources: Map<string, string[]>,
  analyzedFiles: AnalyzedFile[],
): FileCoverage {
  const baseSource = availability(file.oldPath, "old", sources);
  const headSource = availability(file.newPath, "new", sources);
  const analyzed = analyzedFiles.find((entry) => pathForSide(file, entry.side) === entry.path);
  const hasChangedLines = file.lines.some((line) => line.changed);

  let analysis: FileAnalysisCoverage;
  if (file.status === "binary") {
    analysis = { status: "not-analyzed", reason: "binary" };
  } else if (file.status === "deleted" && !hasChangedLines) {
    analysis = { status: "not-analyzed", reason: "deleted" };
  } else if (!hasChangedLines) {
    analysis = { status: "not-analyzed", reason: "metadata-only" };
  } else if (analyzed !== undefined && sources.has(sourceKey(analyzed.side, analyzed.path))) {
    analysis = { status: "analyzed", side: analyzed.side };
  } else if (analyzed !== undefined) {
    analysis = { status: "not-analyzed", reason: "source-unavailable" };
  } else if (file.status === "deleted") {
    analysis = { status: "not-analyzed", reason: "deleted" };
  } else if (file.newPath !== null && headSource === "unavailable") {
    analysis = { status: "not-analyzed", reason: "source-unavailable" };
  } else {
    analysis = { status: "not-analyzed", reason: "unsupported" };
  }

  return {
    oldPath: file.oldPath,
    newPath: file.newPath,
    status: file.status,
    baseSource,
    headSource,
    analysis,
  };
}

function reportCoverage(files: FileCoverage[]): ReportCoverageStatus {
  const analyzedFiles = files.filter((file) => file.analysis.status === "analyzed").length;
  if (analyzedFiles === files.length) {
    return "complete";
  }
  return analyzedFiles === 0 ? "no-coverage" : "partial";
}

function buildValidatedReportFromParsedDiff(
  input: Omit<ValidatedReportInput, "diff">,
  diff: ParsedDiff,
): ValidatedReportResult {
  const changedLocations = new Set(
    diff.files.flatMap((file) =>
      file.lines.filter((line) => line.changed).map((line) => locationKey(line.location)),
    ),
  );
  const mappedSources = sourceMap(input.sources, diff.files);
  if (!mappedSources.ok) {
    return mappedSources;
  }
  const sources = mappedSources.sources;

  for (const candidate of input.candidates) {
    if (!changedLocations.has(locationKey(candidate.location))) {
      const { side, path, line } = candidate.location;
      return {
        ok: false,
        error: {
          code: "invalid-evidence-location",
          message: `Finding ${candidate.ruleId} references ${side} ${path}:${String(line)}, which is not a changed line on that side.`,
          finding: { ruleId: candidate.ruleId, location: candidate.location },
        },
      };
    }
  }

  for (const file of diff.files) {
    for (const diffLine of file.lines) {
      const source = sources.get(sourceKey(diffLine.location.side, diffLine.location.path));
      if (source === undefined) {
        continue;
      }
      const sourceLine = source[diffLine.location.line - 1];
      if (sourceLine === undefined || sourceLine !== diffLine.content) {
        const { side, path, line } = diffLine.location;
        return {
          ok: false,
          error: {
            code: "source-mismatch",
            message: `Source snapshot does not match the diff at ${side} ${path}:${String(line)}.`,
            source: diffLine.location,
          },
        };
      }
    }
  }

  const findings: ReviewFinding[] = [];
  for (const candidate of input.candidates) {
    const source = sources.get(sourceKey(candidate.location.side, candidate.location.path));
    const sourceLine = source?.[candidate.location.line - 1];
    if (sourceLine === undefined) {
      const { side, path, line } = candidate.location;
      return {
        ok: false,
        error: {
          code: "source-unavailable",
          message: `Source snapshot is unavailable for ${side} ${path}:${String(line)}.`,
          source: candidate.location,
        },
      };
    }
    findings.push({ ...candidate, evidence: sourceLine });
  }

  const files = diff.files.map((file) => coverageForFile(file, sources, input.analyzedFiles));
  const coverageStatus = reportCoverage(files);
  const risk = highestSeverity(input.candidates);
  const findingLabel = input.candidates.length === 1 ? "finding" : "findings";
  const fileLabel = files.length === 1 ? "file" : "files";

  return {
    ok: true,
    report: {
      repository: input.repository,
      pullRequest: input.pullRequest,
      summary: `${input.candidates.length} ${findingLabel} across ${files.length} changed ${fileLabel}; coverage: ${coverageStatus}; highest severity: ${risk}.`,
      risk,
      coverage: { status: coverageStatus, files },
      reviewer: input.reviewer,
      findings,
    },
  };
}

export function buildValidatedReport(input: ValidatedReportInput): ValidatedReportResult {
  const parsed = parseUnifiedDiff(input.diff);
  if (!parsed.ok) {
    return parsed;
  }
  return buildValidatedReportFromParsedDiff(input, parsed.diff);
}

const deterministicAnalyzerProfile = "deterministic-security";
const deterministicAnalyzerRule = "lint/security/noGlobalEval";
const deterministicAnalyzerRules = [deterministicAnalyzerRule];
const deterministicAnalyzerVersion = "2.5.8";
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

function supportedHeadSources(input: DeterministicReviewInput): SourceSnapshotFile[] {
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

function candidatesFromSarif(
  report: SarifLog,
  execution: AnalyzerExecutionSuccess,
  diff: ParsedDiff,
):
  | { ok: true; candidates: CandidateFinding[] }
  | Extract<DeterministicReviewResult, { ok: false; error: { code: "analyzer-diagnostic" } }> {
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
  const reportedLocations = new Set<string>();
  const candidates: CandidateFinding[] = [];
  for (const run of report.runs ?? []) {
    for (const result of run.results ?? []) {
      if (typeof result.ruleId === "string" && result.ruleId !== deterministicAnalyzerRule) {
        return {
          ok: false,
          error: {
            code: "analyzer-diagnostic",
            stage: "analyze",
            message: `Biome reported diagnostic ${result.ruleId} outside the deterministic review profile.`,
            analyzer: analyzerDescriptor(),
          },
        };
      }
      if (result.ruleId !== deterministicAnalyzerRule) {
        throw new Error("Biome SARIF contains a diagnostic without a rule identifier.");
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
      const findingLocation = `${path}\0${String(findingLine)}`;
      if (!changedLocations.has(findingLocation) || reportedLocations.has(findingLocation)) {
        continue;
      }
      reportedLocations.add(findingLocation);
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
          version: deterministicAnalyzerVersion,
          ruleId: deterministicAnalyzerRule,
        },
      });
    }
  }
  return {
    ok: true,
    candidates: candidates.toSorted(
      (left, right) =>
        left.location.path.localeCompare(right.location.path) ||
        left.location.line - right.location.line,
    ),
  };
}

function analyzerDescriptor(version = deterministicAnalyzerVersion): AnalyzerDescriptor {
  return {
    tool: "biome",
    version,
    profile: deterministicAnalyzerProfile,
    rules: [...deterministicAnalyzerRules],
  };
}

type RuntimeRecord = Record<string, unknown> & {
  cleanupIncomplete?: unknown;
  version?: unknown;
  ok?: unknown;
  exitCode?: unknown;
  stdout?: unknown;
  stderr?: unknown;
  report?: unknown;
  runs?: unknown;
  artifacts?: unknown;
  failure?: unknown;
  message?: unknown;
  resource?: unknown;
  uri?: unknown;
  path?: unknown;
};

function isRecord(value: unknown): value is RuntimeRecord {
  return typeof value === "object" && value !== null;
}

function hasValidCleanupFlag(value: RuntimeRecord): boolean {
  return value.cleanupIncomplete === undefined || value.cleanupIncomplete === true;
}

function isAnalyzerExecutionResult(value: unknown): value is AnalyzerExecutionResult {
  if (!isRecord(value) || typeof value.version !== "string" || !hasValidCleanupFlag(value)) {
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

export function createDeterministicReviewer(dependencies: {
  executeAnalyzer: ExecuteAnalyzer;
  clock: () => number;
}): {
  review(
    input: DeterministicReviewInput,
    context: AnalyzerContext,
  ): Promise<DeterministicReviewResult>;
} {
  return {
    async review(input, context) {
      if (context.signal.aborted) {
        return {
          ok: false,
          error: {
            code: "cancelled",
            stage: "start",
            message: "The deterministic review was cancelled before analysis started.",
            analyzer: analyzerDescriptor(),
          },
        };
      }
      if (context.deadline <= dependencies.clock()) {
        return {
          ok: false,
          error: {
            code: "deadline-exceeded",
            stage: "start",
            message: "The deterministic review deadline elapsed before analysis started.",
            analyzer: analyzerDescriptor(),
          },
        };
      }
      const sourceValidation = sourceMap(input.sources, input.diff.files, {
        maximumSourceFiles: Math.min(context.limits.maximumSourceFiles, MAX_SOURCE_FILES),
        maximumSourceFileBytes: Math.min(
          context.limits.maximumSourceFileBytes,
          MAX_SOURCE_FILE_BYTES,
        ),
        maximumSnapshotBytes: Math.min(
          context.limits.maximumSnapshotBytes,
          MAX_SOURCE_SNAPSHOT_BYTES,
        ),
      });
      if (!sourceValidation.ok) {
        return sourceValidation;
      }
      const sources = supportedHeadSources(input);
      let execution: AnalyzerExecutionResult;
      try {
        execution = await dependencies.executeAnalyzer(
          {
            profile: deterministicAnalyzerProfile,
            rules: [...deterministicAnalyzerRules],
            sources,
          },
          context,
        );
      } catch {
        return {
          ok: false,
          error: {
            code: "analyzer-execution-failed",
            stage: "execute",
            message: "The analyzer adapter did not complete successfully.",
            analyzer: analyzerDescriptor(),
          },
        };
      }
      if (!isAnalyzerExecutionResult(execution)) {
        return {
          ok: false,
          error: {
            code: "invalid-analyzer-output",
            stage: "validate-output",
            message: "The analyzer adapter returned an invalid result.",
            analyzer: analyzerDescriptor(),
          },
        };
      }
      if (execution.version !== deterministicAnalyzerVersion) {
        return {
          ok: false,
          error: {
            code: "invalid-analyzer-output",
            stage: "validate-output",
            message: "The analyzer provenance did not match the deterministic review profile.",
            analyzer: analyzerDescriptor(),
          },
        };
      }
      if (execution.ok && (execution as unknown as RuntimeRecord).cleanupIncomplete === true) {
        return {
          ok: false,
          error: {
            code: "analyzer-cleanup-failed",
            stage: "cleanup",
            message:
              "The Biome analyzer completed, but its temporary resources could not be cleaned up.",
            analyzer: analyzerDescriptor(),
          },
        };
      }
      if (!execution.ok) {
        if (execution.failure === "cancelled") {
          return {
            ok: false,
            error: {
              code: "cancelled",
              stage: "execute",
              message: "The deterministic review was cancelled during analysis.",
              analyzer: analyzerDescriptor(),
              ...(execution.cleanupIncomplete ? { cleanupIncomplete: true as const } : {}),
            },
          };
        }
        if (execution.failure === "deadline") {
          return {
            ok: false,
            error: {
              code: "deadline-exceeded",
              stage: "execute",
              message: "The deterministic review deadline elapsed during analysis.",
              analyzer: analyzerDescriptor(),
              ...(execution.cleanupIncomplete ? { cleanupIncomplete: true as const } : {}),
            },
          };
        }
        if (execution.failure === "cleanup") {
          return {
            ok: false,
            error: {
              code: "analyzer-cleanup-failed",
              stage: "cleanup",
              message:
                "The Biome analyzer completed, but its temporary resources could not be cleaned up.",
              analyzer: analyzerDescriptor(),
            },
          };
        }
        if (execution.failure === "limit") {
          return {
            ok: false,
            error: {
              code: "analyzer-limit-exceeded",
              stage: "execute",
              resource: execution.resource,
              message: `The Biome analyzer exceeded the configured ${execution.resource} limit.`,
              analyzer: analyzerDescriptor(),
              ...(execution.cleanupIncomplete ? { cleanupIncomplete: true as const } : {}),
            },
          };
        }
        if (execution.failure === "execution") {
          return {
            ok: false,
            error: {
              code: "analyzer-execution-failed",
              stage: "execute",
              message: "The Biome analyzer did not complete successfully.",
              analyzer: analyzerDescriptor(),
              ...(execution.cleanupIncomplete ? { cleanupIncomplete: true as const } : {}),
            },
          };
        }
        return {
          ok: false,
          error: {
            code: "analyzer-start-failed",
            stage: "start",
            message: "Unable to start the Biome analyzer.",
            analyzer: analyzerDescriptor(),
            ...(execution.cleanupIncomplete ? { cleanupIncomplete: true as const } : {}),
          },
        };
      }
      let untrustedReport: unknown;
      try {
        untrustedReport = JSON.parse(execution.report) as unknown;
      } catch {
        return {
          ok: false,
          error: {
            code: "invalid-analyzer-output",
            stage: "validate-output",
            message: "Biome did not produce valid SARIF.",
            analyzer: analyzerDescriptor(),
          },
        };
      }
      if (
        !isRecord(untrustedReport) ||
        untrustedReport.version !== "2.1.0" ||
        !Array.isArray(untrustedReport.runs)
      ) {
        return {
          ok: false,
          error: {
            code: "invalid-analyzer-output",
            stage: "validate-output",
            message: "The Biome analyzer returned invalid SARIF output.",
            analyzer: analyzerDescriptor(),
          },
        };
      }
      const report = untrustedReport as unknown as SarifLog;
      let mapped: ReturnType<typeof candidatesFromSarif>;
      try {
        mapped = candidatesFromSarif(report, execution, input.diff);
      } catch {
        return {
          ok: false,
          error: {
            code: "invalid-analyzer-output",
            stage: "validate-output",
            message: "The Biome analyzer returned invalid SARIF output.",
            analyzer: analyzerDescriptor(),
          },
        };
      }
      if (!mapped.ok) {
        return mapped;
      }

      const built = buildValidatedReportFromParsedDiff(
        {
          repository: input.repository,
          pullRequest: input.pullRequest,
          reviewer: input.reviewer,
          sources: input.sources,
          analyzedFiles: sources.map((source) => ({ side: "new", path: source.path })),
          candidates: mapped.candidates,
        },
        input.diff,
      );
      if (!built.ok) {
        return built;
      }
      const { findings, ...reportWithoutFindings } = built.report;
      return {
        ok: true,
        report: {
          ...reportWithoutFindings,
          analyzer: analyzerDescriptor(),
          findings,
        },
      };
    },
  };
}
