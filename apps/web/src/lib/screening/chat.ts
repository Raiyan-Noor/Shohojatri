"use client";

import { useQuery } from "@tanstack/react-query";

import { api, apiFetch, unwrap } from "@/lib/api/client";
import { readEvents, streamError } from "@/lib/api/sse";
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
  return readEvents(response, signal, (event) => {
    if (event.name === "delta") onText(String(event.data.text ?? ""));
    if (event.name === "error") throw streamError(response.status, event.data.message_key);
    return event.name === "done" ? Number(event.data.message_id) : undefined;
  });
}
