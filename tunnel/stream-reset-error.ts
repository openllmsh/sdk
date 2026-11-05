import type { TStreamResetCode } from "@openllmsh/sdk/protocol";

export class StreamResetError extends Error {
  readonly code: TStreamResetCode;

  constructor(code: TStreamResetCode, message: string) {
    super(message);
    this.name = "StreamResetError";
    this.code = code;
  }
}

export const isStreamResetError = (e: unknown): e is StreamResetError =>
  e instanceof StreamResetError;
