"use client";

import { useQuery } from "@tanstack/react-query";

import { ApiRequestError, api, apiFetch, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

import { screeningKey } from "./queries";

export type ChatMessage = components["schemas"]["ChatMessageOut"];
type Locale = components["schemas"]["Locale"];

export const resultsChatKey = (screeningId: number) =>
  [...screeningKey(screeningId), "chat"] as const;

/** The parent's earlier questions and answers about this screening, and whether AI is on. */
export function useResultsChat(screeningId: number) {
  return useQuery({
    queryKey: resultsChatKey(screeningId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/screenings/{screening_id}/chat", {
          params: { path: { screening_id: screeningId } },
        }),
      ),
  });
}

/**
 * Asks one question and calls `onText` with each piece of the reply as it streams in.
 * Resolves with the saved reply's id. Throws ApiRequestError, with the API's error shape when
 * there is one, if the question is refused or the reply breaks off.
 */
export async function askResultsChat(
  screeningId: number,
  body: { message: string; locale: Locale },
  onText: (text: string) => void,
  signal: AbortSignal,
): Promise<number> {
  const response = await apiFetch(`/api/v1/screenings/${screeningId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
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
        if (event?.name === "delta") onText(String(event.data.text ?? ""));
        if (event?.name === "done") return Number(event.data.message_id);
        if (event?.name === "error") throw streamError(response.status, event.data.message_key);
      }
    }
  } catch (error) {
    if (error instanceof ApiRequestError || signal.aborted) throw error;
    throw new ApiRequestError(null, null);
  } finally {
    reader.releaseLock();
  }
  // The stream ended without "done": the connection dropped mid-reply.
  throw streamError(response.status, "errors.ai_unavailable");
}

function parseEvent(block: string): { name: string; data: Record<string, unknown> } | null {
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

function streamError(status: number, messageKey: unknown): ApiRequestError {
  const key = typeof messageKey === "string" ? messageKey : "errors.ai_unavailable";
  return new ApiRequestError(status, {
    error: { code: key.replace(/^errors\./, ""), message_key: key, detail: {} },
  });
}
