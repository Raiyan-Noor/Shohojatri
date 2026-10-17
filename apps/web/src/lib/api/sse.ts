import { ApiRequestError } from "./client";

export type SseEvent = { name: string; data: Record<string, unknown> };

/**
 * Reads a server-sent event stream and hands each event to `onEvent`. Return a value from
 * `onEvent` to stop reading and resolve with it. Throws ApiRequestError if the connection drops
 * before that, or rethrows what `onEvent` threw.
 */
export async function readEvents<T>(
  response: Response,
  signal: AbortSignal,
  onEvent: (event: SseEvent) => T | undefined,
): Promise<T> {
  if (!response.body) throw new ApiRequestError(null, null);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      // Events end with a blank line; keep any partial event for the next chunk.
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const event = parseEvent(block);
        const result = event && onEvent(event);
        if (result !== undefined && result !== null) return result;
      }
    }
  } catch (error) {
    if (error instanceof ApiRequestError || signal.aborted) throw error;
    throw new ApiRequestError(null, null);
  } finally {
    reader.releaseLock();
  }
  // The stream ended without its last event: the connection dropped mid-reply.
  throw streamError(response.status, "errors.ai_unavailable");
}

/** The error an `error` event (or a dropped stream) stands for, in the API's error shape. */
export function streamError(status: number, messageKey: unknown): ApiRequestError {
  const key = typeof messageKey === "string" ? messageKey : "errors.ai_unavailable";
  return new ApiRequestError(status, {
    error: { code: key.replace(/^errors\./, ""), message_key: key, detail: {} },
  });
}

function parseEvent(block: string): SseEvent | null {
  let name = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  try {
    return { name, data: JSON.parse(data) as Record<string, unknown> };
  } catch {
    return null;
  }
}
