import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { finished } from "node:stream/promises";

export interface BoundedFileContext {
  signal: AbortSignal;
  deadline: number;
  graceMilliseconds: number;
}

export interface BoundedFileOptions {
  beforeRead?(): Promise<void>;
  afterChunkRead?(): void;
}

export type BoundedFileResult =
  | { ok: true; text: string; bytes: number }
  | { ok: false; failure: "limit" | "io" }
  | {
      ok: false;
      failure: "cancelled" | "deadline";
      cleanupIncomplete?: true;
    };

type TerminalReason = { failure: "cancelled" | "deadline" };

function createTerminalTracker(context: BoundedFileContext): {
  terminal: Promise<TerminalReason>;
  stop(): void;
} {
  let reason: TerminalReason | undefined;
  let resolveTerminal!: (terminal: TerminalReason) => void;
  const terminal = new Promise<TerminalReason>((resolve) => {
    resolveTerminal = resolve;
  });
  const claim = (terminalReason: TerminalReason): void => {
    if (reason === undefined) {
      reason = terminalReason;
      resolveTerminal(terminalReason);
    }
  };
  const cancel = (): void => claim({ failure: "cancelled" });
  let deadlineTimer: NodeJS.Timeout | undefined;
  context.signal.addEventListener("abort", cancel, { once: true });
  if (context.signal.aborted) {
    cancel();
  } else {
    deadlineTimer = setTimeout(
      () => claim({ failure: "deadline" }),
      Math.max(0, context.deadline - Date.now()),
    );
  }
  return {
    terminal,
    stop() {
      context.signal.removeEventListener("abort", cancel);
      if (deadlineTimer !== undefined) {
        clearTimeout(deadlineTimer);
      }
    },
  };
}

async function settlesWithin(operation: Promise<unknown>, milliseconds: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const settled = await Promise.race([
    operation.then(
      () => true,
      () => true,
    ),
    new Promise<false>((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout(false), milliseconds);
    }),
  ]);
  if (timer !== undefined) {
    clearTimeout(timer);
  }
  return settled;
}

export async function readBoundedTextFile(
  path: string,
  maximumBytes: number,
  context: BoundedFileContext,
  options: BoundedFileOptions = {},
): Promise<BoundedFileResult> {
  if (context.signal.aborted) {
    return { ok: false, failure: "cancelled" };
  }
  if (context.deadline <= Date.now()) {
    return { ok: false, failure: "deadline" };
  }

  const inputAbort = new AbortController();
  const reading = (async (): Promise<BoundedFileResult> => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let stream: ReturnType<typeof createReadStream> | undefined;
    try {
      await options.beforeRead?.();
      const fileStat = await stat(path);
      if (fileStat.size > maximumBytes) {
        return { ok: false, failure: "limit" };
      }
      stream = createReadStream(path, {
        highWaterMark: Math.max(1, Math.min(65_536, maximumBytes + 1)),
        signal: inputAbort.signal,
      });
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (bytes > maximumBytes) {
          return { ok: false, failure: "limit" };
        }
        chunks.push(buffer);
        options.afterChunkRead?.();
      }
      return { ok: true, text: Buffer.concat(chunks, bytes).toString("utf8"), bytes };
    } catch {
      return { ok: false, failure: "io" };
    } finally {
      if (stream !== undefined) {
        stream.destroy();
        await finished(stream).catch(() => undefined);
      }
    }
  })();
  const tracker = createTerminalTracker(context);
  const first = await Promise.race([
    reading.then((result) => ({ kind: "read" as const, result })),
    tracker.terminal.then((reason) => ({ kind: "terminal" as const, reason })),
  ]);
  tracker.stop();
  if (first.kind === "read") {
    return first.result;
  }

  inputAbort.abort();
  const stopped = await settlesWithin(reading, context.graceMilliseconds);
  return {
    ok: false,
    ...first.reason,
    ...(stopped ? {} : { cleanupIncomplete: true as const }),
  };
}
