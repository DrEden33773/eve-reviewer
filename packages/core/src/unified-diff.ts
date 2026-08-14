import { isAbsolute, normalize, sep } from "node:path";

import { parsePatch } from "diff";

export type DiffSide = "old" | "new";

export interface EvidenceLocation {
  side: DiffSide;
  path: string;
  line: number;
}

export interface DiffLine {
  location: EvidenceLocation;
  content: string;
  changed: boolean;
}

export type ChangedFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "binary"
  | "metadata-only";

export interface ChangedFile {
  oldPath: string | null;
  newPath: string | null;
  status: ChangedFileStatus;
  lines: DiffLine[];
}

export interface ParsedDiff {
  files: ChangedFile[];
}

export type DiffParseResult =
  | { ok: true; diff: ParsedDiff }
  | { ok: false; error: { code: "invalid-diff"; message: string } };

export const MAX_DIFF_BYTES = 1_000_000;
const MAX_CHANGED_FILES = 100;
const MAX_ADDED_LINES = 10_000;
const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);

function malformed(message: string): DiffParseResult {
  return { ok: false, error: { code: "invalid-diff", message } };
}

function validateHunkCoordinates(source: string): DiffParseResult | undefined {
  for (const line of source.split("\n")) {
    if (!line.startsWith("@@ ")) {
      continue;
    }
    const match = hunkHeader.exec(line);
    if (match?.[1] === undefined || match[3] === undefined) {
      return malformed("Malformed unified diff: invalid hunk header.");
    }
    const values = [match[1], match[2] ?? "1", match[3], match[4] ?? "1"].map((value) =>
      BigInt(value),
    );
    if (values.some((value) => value > maximumSafeInteger)) {
      return malformed("Malformed unified diff: hunk header values must be safe integers.");
    }
    const [oldStart, oldCount, newStart, newCount] = values;
    if (
      oldStart === undefined ||
      oldCount === undefined ||
      newStart === undefined ||
      newCount === undefined
    ) {
      return malformed("Malformed unified diff: invalid hunk header.");
    }
    const oldEnd = oldStart + (oldCount > 0n ? oldCount - 1n : 0n);
    const newEnd = newStart + (newCount > 0n ? newCount - 1n : 0n);
    if (oldEnd > maximumSafeInteger || newEnd > maximumSafeInteger) {
      return malformed("Malformed unified diff: hunk ranges must use safe integers.");
    }
  }
  return undefined;
}

function normalizePath(value: string | undefined): string | undefined {
  if (value === undefined || value === "/dev/null") {
    return undefined;
  }
  return value.startsWith("a/") || value.startsWith("b/") ? value.slice(2) : value;
}

function isSafeSnapshotPath(path: string): boolean {
  const normalized = normalize(path);
  return (
    !isAbsolute(path) &&
    path !== "" &&
    !path.includes("\\") &&
    !path.split("/").includes("..") &&
    normalized !== ".." &&
    !normalized.startsWith(`..${sep}`) &&
    normalized !== "."
  );
}

function parseFailure(error: unknown): DiffParseResult {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("line count did not match") ||
    message.includes("has more lines than expected")
  ) {
    return malformed("Malformed unified diff: hunk line counts do not match its header.");
  }
  return malformed(`Malformed unified diff: ${message}`);
}

function hunkContent(rawLine: string): string {
  const content = rawLine.slice(1);
  return content.endsWith("\r") ? content.slice(0, -1) : content;
}

function patchKey(oldFileName: string | undefined, newFileName: string | undefined): string {
  return `${oldFileName ?? ""}\0${newFileName ?? ""}`;
}

function gitBinaryPatchKeys(source: string): Set<string> {
  const keys = new Set<string>();
  for (const section of source.split(/(?=^diff --git )/m)) {
    if (!/^GIT binary patch\r?$/m.test(section)) {
      continue;
    }
    const [patch] = parsePatch(section);
    if (patch !== undefined) {
      keys.add(patchKey(patch.oldFileName, patch.newFileName));
    }
  }
  return keys;
}

export function parseUnifiedDiff(source: string): DiffParseResult {
  if (Buffer.byteLength(source, "utf8") > MAX_DIFF_BYTES) {
    return malformed(`Diff exceeds the ${MAX_DIFF_BYTES}-byte input limit.`);
  }
  const unsafeCoordinates = validateHunkCoordinates(source);
  if (unsafeCoordinates !== undefined) {
    return unsafeCoordinates;
  }

  let patches: ReturnType<typeof parsePatch>;
  try {
    patches = parsePatch(source);
  } catch (error) {
    return parseFailure(error);
  }
  if (patches.length === 0) {
    return malformed("Malformed unified diff: no reviewable file was found.");
  }
  if (patches.length > MAX_CHANGED_FILES) {
    return malformed(`Diff exceeds the ${MAX_CHANGED_FILES}-changed-file limit.`);
  }

  const files: ChangedFile[] = [];
  const gitBinaryPatches = gitBinaryPatchKeys(source);
  let addedLineCount = 0;

  for (const patch of patches) {
    const isBinary =
      patch.isBinary === true ||
      gitBinaryPatches.has(patchKey(patch.oldFileName, patch.newFileName));
    if (
      patch.hunks.length === 0 &&
      !isBinary &&
      patch.isRename !== true &&
      patch.isCreate !== true &&
      patch.isDelete !== true &&
      patch.oldMode === undefined &&
      patch.newMode === undefined
    ) {
      return malformed(
        "Malformed unified diff: a changed file has no content or recognized metadata.",
      );
    }
    const oldPath = patch.isCreate === true ? undefined : normalizePath(patch.oldFileName);
    const newPath = patch.isDelete === true ? undefined : normalizePath(patch.newFileName);
    if (oldPath === undefined && newPath === undefined) {
      return malformed("Malformed unified diff: a changed file has no usable path.");
    }
    if (
      (oldPath !== undefined && !isSafeSnapshotPath(oldPath)) ||
      (newPath !== undefined && !isSafeSnapshotPath(newPath))
    ) {
      return malformed(
        "Malformed unified diff: changed paths must stay inside the source snapshot.",
      );
    }
    const lines: DiffLine[] = [];
    for (const hunk of patch.hunks) {
      let nextOldLine = hunk.oldStart;
      let nextNewLine = hunk.newStart;
      for (const rawLine of hunk.lines) {
        if (rawLine.startsWith("+")) {
          if (addedLineCount === MAX_ADDED_LINES) {
            return malformed(`Diff exceeds the ${MAX_ADDED_LINES}-added-line limit.`);
          }
          addedLineCount += 1;
          lines.push({
            location: { side: "new", path: newPath ?? oldPath ?? "", line: nextNewLine },
            content: hunkContent(rawLine),
            changed: true,
          });
          nextNewLine += 1;
        } else if (rawLine.startsWith("-")) {
          lines.push({
            location: { side: "old", path: oldPath ?? newPath ?? "", line: nextOldLine },
            content: hunkContent(rawLine),
            changed: true,
          });
          nextOldLine += 1;
        } else if (rawLine.startsWith(" ")) {
          const content = hunkContent(rawLine);
          lines.push({
            location: { side: "old", path: oldPath ?? newPath ?? "", line: nextOldLine },
            content,
            changed: false,
          });
          lines.push({
            location: { side: "new", path: newPath ?? oldPath ?? "", line: nextNewLine },
            content,
            changed: false,
          });
          nextOldLine += 1;
          nextNewLine += 1;
        } else if (!rawLine.startsWith("\\ No newline")) {
          return malformed("Malformed unified diff: invalid hunk body line.");
        }
      }
    }
    files.push({
      oldPath: oldPath ?? null,
      newPath: newPath ?? null,
      status: isBinary
        ? "binary"
        : newPath === undefined
          ? "deleted"
          : oldPath === undefined
            ? "added"
            : oldPath !== newPath
              ? "renamed"
              : patch.hunks.length === 0
                ? "metadata-only"
                : "modified",
      lines,
    });
  }

  return { ok: true, diff: { files } };
}
