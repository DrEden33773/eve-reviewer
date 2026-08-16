import type {
  AnalyzeReviewInput,
  AnalyzerDescriptor,
  CandidateFinding,
  SourceSnapshotFile,
} from "@eve-reviewer/core";

export const deterministicBiomePolicy = {
  profile: "adam-biome-recommended-v1",
  rule: "lint/security/noGlobalEval",
  version: "2.5.8",
} as const;

const supportedSourceExtensions = [
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
] as const;

type FileOutcome =
  | { side: "old" | "new"; path: string; status: "analyzed" }
  | {
      side: "old" | "new";
      path: string;
      status: "skipped";
      reason: "binary" | "deleted" | "metadata-only" | "source-unavailable" | "unsupported";
    };

export type DeterministicBiomeDiagnostic = {
  readonly line: number;
  readonly path: string;
};

function analyzerDescriptor(): AnalyzerDescriptor {
  return {
    tool: "biome",
    version: deterministicBiomePolicy.version,
    profile: deterministicBiomePolicy.profile,
    rules: [deterministicBiomePolicy.rule],
  };
}

export function supportedHeadSources(input: AnalyzeReviewInput): SourceSnapshotFile[] {
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
      return [{ side, path, status: "analyzed" }];
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
    return [{ side, path, status: "skipped", reason }];
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

export function skippedBiomeOutcome(input: AnalyzeReviewInput) {
  return {
    kind: "eve-reviewer.analyzer-outcome",
    schemaVersion: 1,
    payload: {
      analyzer: analyzerDescriptor(),
      status: "skipped",
      files: fileOutcomes(input, new Set()),
    },
  } as const;
}

export function failedBiomeOutcome(
  input: AnalyzeReviewInput,
  message:
    | "The Biome broker returned an invalid report."
    | "The Biome broker returned an invalid response.",
) {
  return {
    kind: "eve-reviewer.analyzer-outcome",
    schemaVersion: 1,
    payload: {
      analyzer: analyzerDescriptor(),
      status: "failed",
      files: failedFileOutcomes(input),
      diagnostic: { code: "invalid-analyzer-output", message },
    },
  } as const;
}

export function analyzedBiomeOutcome(
  input: AnalyzeReviewInput,
  sources: readonly SourceSnapshotFile[],
  diagnostics: readonly DeterministicBiomeDiagnostic[],
) {
  const changedLocations = new Set(
    input.diff.files.flatMap((file) =>
      file.lines
        .filter((line) => line.changed && line.location.side === "new")
        .map((line) => `${line.location.path}\0${String(line.location.line)}`),
    ),
  );
  const candidates: CandidateFinding[] = diagnostics.flatMap((diagnostic) => {
    if (!changedLocations.has(`${diagnostic.path}\0${String(diagnostic.line)}`)) {
      return [];
    }
    return [
      {
        ruleId: "security/no-dynamic-eval",
        severity: "critical",
        title: "Dynamic code evaluation",
        explanation: "Code added by the change evaluates text as executable code.",
        location: { side: "new", path: diagnostic.path, line: diagnostic.line },
        fixGuidance: "Replace eval with an explicit parser or an allow-listed operation map.",
        suggestedTests: "Exercise hostile and malformed input and assert it is never executed.",
        confidence: 0.95,
        provenance: {
          tool: "biome",
          version: deterministicBiomePolicy.version,
          ruleId: deterministicBiomePolicy.rule,
        },
      } satisfies CandidateFinding,
    ];
  });
  return {
    kind: "eve-reviewer.analyzer-outcome",
    schemaVersion: 1,
    payload: {
      analyzer: analyzerDescriptor(),
      status: "analyzed",
      files: fileOutcomes(input, new Set(sources.map((source) => source.path))),
      candidates,
    },
  } as const;
}
