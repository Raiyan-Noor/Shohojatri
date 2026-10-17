"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { CHILDREN_KEY, childKey } from "@/lib/children/queries";

export type Diagnosis = components["schemas"]["Diagnosis"];
export type DiagnosisKind = Diagnosis["kind"];
export type Questionnaire = components["schemas"]["CharacteristicsQuestionnaireOut"];
export type QuestionnaireSection = components["schemas"]["SectionOut"];
export type Question = components["schemas"]["QuestionOut"];
export type Characteristics = components["schemas"]["CharacteristicsOut"];
export type Goal = components["schemas"]["GoalOut"];

/** Answer shapes per question type (app/core/characteristics.py). */
export type ChoiceAnswer = { selected: string[]; other_text?: string | null };
export type TherapyRow = {
  type: string;
  other_text?: string | null;
  provider?: string | null;
  frequency?: string | null;
};
export type Answer = ChoiceAnswer | Record<string, string> | string | string[] | TherapyRow[];
export type SectionAnswers = Record<string, Answer>;

const path = (childId: number) => ({ params: { path: { child_id: childId } } });

/** The questionnaire content ships with the API and never changes while the app is open. */
export function useQuestionnaire() {
  return useQuery({
    queryKey: ["characteristics-questionnaire"],
    queryFn: () => unwrap(api.GET("/api/v1/characteristics/questionnaire")),
    staleTime: Infinity,
  });
}

export function useCharacteristics(childId: number) {
  return useQuery({
    queryKey: [...childKey(childId), "characteristics"],
    queryFn: () => unwrap(api.GET("/api/v1/children/{child_id}/characteristics", path(childId))),
  });
}

export function useSaveSection(childId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ section, answers }: { section: string; answers: SectionAnswers }) =>
      unwrap(
        api.PUT("/api/v1/children/{child_id}/characteristics/sections/{section_id}", {
          params: { path: { child_id: childId, section_id: section } },
          body: { answers },
        }),
      ),
    onSuccess: (data) => {
      queryClient.setQueryData([...childKey(childId), "characteristics"], data);
      // The card's "n of 10 done".
      void queryClient.invalidateQueries({ queryKey: CHILDREN_KEY });
    },
  });
}

export function useActivate(childId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Diagnosis) =>
      unwrap(api.POST("/api/v1/children/{child_id}/activate", { ...path(childId), body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHILDREN_KEY }),
  });
}

export function useGoals(childId: number) {
  return useQuery({
    queryKey: [...childKey(childId), "goals"],
    queryFn: () => unwrap(api.GET("/api/v1/children/{child_id}/goals", path(childId))),
  });
}
