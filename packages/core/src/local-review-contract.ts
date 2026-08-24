// biome-ignore-all lint/complexity/useLiteralKeys: Runtime contract inspection requires indexed access to unknown records.
import Type from "typebox";
import Schema from "typebox/schema";

import type { ContractIssue, ContractRejection } from "./review-contract.ts";

const maximumDiffCharacters = 1_000_000;
const maximumSourceCharacters = 1_000_000;
const maximumSourceFilesPerSide = 100;

const sourceFileSchema = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 4_096 }),
    content: Type.String({ maxLength: maximumSourceCharacters }),
  },
  { additionalProperties: false },
);

const sourceSnapshotSchema = Type.Object(
  {
    base: Type.Array(sourceFileSchema, { maxItems: maximumSourceFilesPerSide }),
    head: Type.Array(sourceFileSchema, { maxItems: maximumSourceFilesPerSide }),
  },
  { additionalProperties: false },
);

function subjectSchema(objectFormat: "sha1" | "sha256", objectIdPattern: string) {
  const objectId = Type.String({ pattern: objectIdPattern });
  return Type.Object(
    {
      kind: Type.Literal("local-worktree"),
      objectFormat: Type.Literal(objectFormat),
      base: Type.Union([
        Type.Object(
          {
            kind: Type.Literal("head"),
            commit: objectId,
            tree: objectId,
          },
          { additionalProperties: false },
        ),
        Type.Object(
          {
            kind: Type.Literal("unborn"),
            tree: objectId,
          },
          { additionalProperties: false },
        ),
      ]),
      candidateTree: objectId,
      snapshotDigest: Type.String({ pattern: "^sha256:[0-9a-f]{64}$" }),
    },
    { additionalProperties: false },
  );
}

export const localWorktreeSubjectSchema = Type.Union([
  subjectSchema("sha1", "^[0-9a-f]{40}$"),
  subjectSchema("sha256", "^[0-9a-f]{64}$"),
]);

const localReviewRequestSchema = Type.Object(
  {
    kind: Type.Literal("eve-reviewer.local-review-request"),
    schemaVersion: Type.Literal(1),
    payload: Type.Object(
      {
        subject: localWorktreeSubjectSchema,
        reviewer: Type.String({ minLength: 1, maxLength: 128 }),
        diff: Type.String({ maxLength: maximumDiffCharacters }),
        sources: sourceSnapshotSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const localReviewRequestValidator = Schema.Compile(localReviewRequestSchema);

export type LocalReviewRequestEnvelope = Type.Static<typeof localReviewRequestSchema>;

export type DecodeLocalReviewRequestResult =
  | { ok: true; value: LocalReviewRequestEnvelope }
  | { ok: false; error: ContractRejection };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasObjectFormatMismatch(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value["payload"])) {
    return false;
  }
  const subject = value["payload"]["subject"];
  if (!isRecord(subject) || !isRecord(subject["base"])) {
    return false;
  }
  const objectFormat = subject["objectFormat"];
  if (objectFormat !== "sha1" && objectFormat !== "sha256") {
    return false;
  }
  const base = subject["base"];
  const objectIds = [
    base["tree"],
    ...(base["kind"] === "head" ? [base["commit"]] : []),
    subject["candidateTree"],
  ];
  const expectedLength = objectFormat === "sha1" ? 40 : 64;
  for (const objectId of objectIds) {
    if (typeof objectId !== "string") {
      return false;
    }
    if (objectId.length !== expectedLength) {
      return true;
    }
  }
  return false;
}

function requestIssues(value: unknown): ContractIssue[] {
  const [, errors] = localReviewRequestValidator.Errors(value);
  const error = errors[0];
  if (error?.keyword === "required") {
    const property = error.params.requiredProperties[0];
    return [{ path: `${error.instancePath}/${property}`, code: "required" }];
  }
  if (error?.keyword === "additionalProperties") {
    const property = error.params.additionalProperties[0];
    return [{ path: `${error.instancePath}/${property}`, code: "unknown-field" }];
  }
  return [{ path: error?.instancePath || "/", code: error?.keyword ?? "invalid" }];
}

export const localReviewContractV1 = {
  decodeRequest(value: unknown): DecodeLocalReviewRequestResult {
    if (
      typeof value === "object" &&
      value !== null &&
      "schemaVersion" in value &&
      Number.isSafeInteger(value.schemaVersion) &&
      value.schemaVersion !== 1
    ) {
      return {
        ok: false,
        error: {
          code: "unsupported-schema-version",
          stage: "decode-request",
          issues: [{ path: "/schemaVersion", code: "unsupported" }],
        },
      };
    }
    if (hasObjectFormatMismatch(value)) {
      return {
        ok: false,
        error: {
          code: "invalid-contract",
          stage: "decode-request",
          issues: [
            {
              path: "/payload/subject/objectFormat",
              code: "object-format-mismatch",
            },
          ],
        },
      };
    }
    if (localReviewRequestValidator.Check(value)) {
      return { ok: true, value };
    }
    return {
      ok: false,
      error: {
        code: "invalid-contract",
        stage: "decode-request",
        issues: requestIssues(value),
      },
    };
  },
};
