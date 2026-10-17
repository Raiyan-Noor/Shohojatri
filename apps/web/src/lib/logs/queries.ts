"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { CHILDREN_KEY, childKey } from "@/lib/children/queries";

export type LogEntry = components["schemas"]["LogOut"];
export type LogType = LogEntry["type"];
export type LogDomain = components["schemas"]["LogDomain"];
export type LogVisibility = LogEntry["visibility"];
export type GoalProgress = NonNullable<LogEntry["goal_progress"]>;
export type NewLog = components["schemas"]["CreateLogRequest"];
export type LogEdit = components["schemas"]["UpdateLogRequest"];
export type LogExplanation = components["schemas"]["LogExplanation"];
export type AuthorRole = "parent" | "teacher" | "specialist";

export type LogFilters = { authorRole?: AuthorRole; domain?: LogDomain; type?: LogType };

const PAGE = 30;
const logsKey = (childId: number) => [...childKey(childId), "logs"] as const;

export function useLogs(childId: number, filters: LogFilters) {
  return useInfiniteQuery({
    queryKey: [...logsKey(childId), filters],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/children/{child_id}/logs", {
          params: {
            path: { child_id: childId },
            query: {
              author_role: filters.authorRole,
              domain: filters.domain,
              type: filters.type,
              offset: pageParam,
              limit: PAGE,
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.next_offset ?? undefined,
  });
}

export function useLog(childId: number, logId: number) {
  return useQuery({
    queryKey: [...logsKey(childId), "one", logId],
    queryFn: () =>
      unwrap(api.GET("/api/v1/logs/{log_id}", { params: { path: { log_id: logId } } })),
  });
}

/** After any change: the timeline, and the cards' "N new" counts. */
function useInvalidateLogs(childId: number) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: logsKey(childId) }),
      queryClient.invalidateQueries({ queryKey: CHILDREN_KEY, exact: true }),
    ]);
}

export function useCreateLog(childId: number) {
  const invalidate = useInvalidateLogs(childId);
  return useMutation({
    mutationFn: (body: NewLog) =>
      unwrap(
        api.POST("/api/v1/children/{child_id}/logs", {
          params: { path: { child_id: childId } },
          body,
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useUpdateLog(childId: number) {
  const invalidate = useInvalidateLogs(childId);
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: LogEdit }) =>
      unwrap(api.PATCH("/api/v1/logs/{log_id}", { params: { path: { log_id: id } }, body })),
    onSuccess: invalidate,
  });
}

/** Not cached: each explanation is asked for on purpose and isn't saved. */
export function useExplainLog() {
  return useMutation({
    mutationFn: ({ id, locale }: { id: number; locale: "bn" | "en" }) =>
      unwrap(
        api.POST("/api/v1/logs/{log_id}/explain", {
          params: { path: { log_id: id } },
          body: { locale },
        }),
      ),
  });
}
