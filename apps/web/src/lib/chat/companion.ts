"use client";

import { useQuery } from "@tanstack/react-query";

import { api, apiFetch, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { readEvents, streamError } from "@/lib/api/sse";

export type CompanionMessage = components["schemas"]["CompanionMessageOut"];
export type ChatSource = components["schemas"]["ChatSource"];
export type ChatSuggestion = components["schemas"]["ChatSuggestion"];
export type ConversationSummary = components["schemas"]["ConversationSummary"];
type Locale = components["schemas"]["Locale"];

const chatKey = (childId: number) => ["children", childId, "chat"] as const;
export const conversationsKey = (childId: number) => [...chatKey(childId), "list"] as const;
export const messagesKey = (conversationId: number) =>
  ["conversations", conversationId, "messages"] as const;

/** Starter questions for this viewer, and whether AI is switched on at all. */
export function useChatSuggestions(childId: number) {
  return useQuery({
    queryKey: [...chatKey(childId), "suggestions"],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/children/{child_id}/chat/suggestions", {
          params: { path: { child_id: childId } },
        }),
      ),
    staleTime: 5 * 60_000,
  });
}

/** The viewer's own conversations about this child, most recent first. */
export function useConversations(childId: number, enabled = true) {
  return useQuery({
    queryKey: conversationsKey(childId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/children/{child_id}/conversations", {
          params: { path: { child_id: childId } },
        }),
      ),
    enabled,
  });
}

export function useConversationMessages(conversationId: number | null) {
  return useQuery({
    queryKey: messagesKey(conversationId ?? 0),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/conversations/{conversation_id}/messages", {
          params: { path: { conversation_id: conversationId ?? 0 } },
        }),
      ),
    enabled: conversationId !== null,
  });
}

export type ChatDone = { messageId: number; sources: ChatSource[]; urgent: boolean };

type Handlers = {
  /** First event: the conversation's id (new or continued), and whether the question itself
   *  sounds urgent, so the urgent card can show before the reply arrives. */
  onMeta: (meta: { conversationId: number; urgent: boolean }) => void;
  onText: (text: string) => void;
};

/**
 * Asks one question and streams the reply. Resolves when the reply is saved. Throws
 * ApiRequestError, with the API's error shape when there is one, if the question is refused or
 * the reply breaks off.
 */
export async function askCompanionChat(
  childId: number,
  body: { conversation_id: number | null; message: string; locale: Locale },
  handlers: Handlers,
  signal: AbortSignal,
): Promise<ChatDone> {
  const response = await apiFetch(`/api/v1/children/${childId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  return readEvents<ChatDone>(response, signal, ({ name, data }) => {
    if (name === "meta") {
      handlers.onMeta({ conversationId: Number(data.conversation_id), urgent: !!data.urgent });
    }
    if (name === "delta") handlers.onText(String(data.text ?? ""));
    if (name === "error") throw streamError(response.status, data.message_key);
    if (name !== "done") return undefined;
    return {
      messageId: Number(data.message_id),
      sources: (data.sources ?? []) as ChatSource[],
      urgent: !!data.urgent,
    };
  });
}
