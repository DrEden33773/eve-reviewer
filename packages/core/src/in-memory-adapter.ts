import type { AnalyzerContext } from "./index.ts";
import { reviewContractV1 } from "./review-contract.ts";

export interface InMemoryReviewPort {
  review(request: unknown, context: AnalyzerContext): Promise<unknown>;
}

export interface InMemoryReviewAdapterDependencies extends InMemoryReviewPort {
  maximumRequestBytes?: number;
  maximumResultBytes?: number;
}

const maximumContractRequestBytes = 12_000_000;
const maximumContractResultBytes = 5_000_000;

function tightenedLimit(requested: number | undefined, maximum: number): number {
  if (requested === undefined) {
    return maximum;
  }
  if (Number.isNaN(requested) || requested <= 0) {
    return 0;
  }
  if (!Number.isFinite(requested)) {
    return maximum;
  }
  return Math.min(Math.floor(requested), maximum);
}

function encodeRequestRejection(issueCode: "invalid-json" | "max-bytes"): string {
  const encoded = reviewContractV1.encodeResult({
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: {
        code: "invalid-contract",
        stage: "decode-request",
        issues: [{ path: "/", code: issueCode }],
      },
    },
  });
  if (!encoded.ok) {
    throw new Error("Unable to encode the request contract rejection.");
  }
  return encoded.value;
}

function encodeResultLimitRejection(): string {
  const encoded = reviewContractV1.encodeResult({
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: {
        code: "invalid-contract",
        stage: "encode-result",
        issues: [{ path: "/", code: "max-bytes" }],
      },
    },
  });
  if (!encoded.ok) {
    throw new Error("Unable to encode the result limit rejection.");
  }
  return encoded.value;
}

export function createInMemoryReviewAdapter(dependencies: InMemoryReviewAdapterDependencies) {
  const maximumRequestBytes = tightenedLimit(
    dependencies.maximumRequestBytes,
    maximumContractRequestBytes,
  );
  const maximumResultBytes = tightenedLimit(
    dependencies.maximumResultBytes,
    maximumContractResultBytes,
  );
  return {
    async review(serializedRequest: string, context: AnalyzerContext): Promise<string> {
      if (Buffer.byteLength(serializedRequest, "utf8") > maximumRequestBytes) {
        return encodeRequestRejection("max-bytes");
      }
      let request: unknown;
      try {
        request = JSON.parse(serializedRequest) as unknown;
      } catch {
        return encodeRequestRejection("invalid-json");
      }
      const result = await dependencies.review(request, context);
      const encoded = reviewContractV1.encodeResult(result);
      if (!encoded.ok) {
        const rejection = reviewContractV1.encodeResult({
          kind: "eve-reviewer.review-result",
          schemaVersion: 1,
          payload: { ok: false, error: encoded.error },
        });
        if (!rejection.ok) {
          throw new Error("Unable to encode the invalid result contract rejection.");
        }
        return rejection.value;
      }
      if (Buffer.byteLength(encoded.value, "utf8") > maximumResultBytes) {
        return encodeResultLimitRejection();
      }
      return encoded.value;
    },
  };
}
