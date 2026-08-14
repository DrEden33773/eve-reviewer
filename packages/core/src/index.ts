import {
  type ChangedFile,
  type ChangedFileStatus,
  type DiffSide,
  type EvidenceLocation,
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

function sourceMap(sources: ReviewSources, files: ChangedFile[]): SourceMapResult {
  const result = new Map<string, string[]>();
  const oldPaths = new Set(files.flatMap((file) => (file.oldPath === null ? [] : [file.oldPath])));
  const newPaths = new Set(files.flatMap((file) => (file.newPath === null ? [] : [file.newPath])));
  for (const [label, side, snapshot, changedPaths] of [
    ["Base", "old", sources.base, oldPaths],
    ["Head", "new", sources.head, newPaths],
  ] as const) {
    if (snapshot.length > MAX_SOURCE_FILES) {
      return {
        ok: false,
        error: {
          code: "invalid-source",
          message: `${label} source snapshot exceeds the ${MAX_SOURCE_FILES}-file limit.`,
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
      if (sourceBytes > MAX_SOURCE_FILE_BYTES) {
        return {
          ok: false,
          error: {
            code: "invalid-source",
            message: `${label} source file exceeds the ${MAX_SOURCE_FILE_BYTES}-byte limit: ${source.path}.`,
          },
        };
      }
      aggregateBytes += sourceBytes;
      if (aggregateBytes > MAX_SOURCE_SNAPSHOT_BYTES) {
        return {
          ok: false,
          error: {
            code: "invalid-source",
            message: `${label} source snapshot exceeds the ${MAX_SOURCE_SNAPSHOT_BYTES}-byte aggregate limit.`,
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

export function buildValidatedReport(input: ValidatedReportInput): ValidatedReportResult {
  const parsed = parseUnifiedDiff(input.diff);
  if (!parsed.ok) {
    return parsed;
  }

  const changedLocations = new Set(
    parsed.diff.files.flatMap((file) =>
      file.lines.filter((line) => line.changed).map((line) => locationKey(line.location)),
    ),
  );
  const mappedSources = sourceMap(input.sources, parsed.diff.files);
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

  for (const file of parsed.diff.files) {
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

  const files = parsed.diff.files.map((file) =>
    coverageForFile(file, sources, input.analyzedFiles),
  );
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
