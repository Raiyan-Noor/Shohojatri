import type { components } from "@/lib/api/schema";

export type Report = components["schemas"]["ReportOut"];
export type ReportItem = components["schemas"]["ReportItem"];
export type RiskResult = components["schemas"]["RiskResult"];
export type RiskClass = components["schemas"]["RiskClass"];
export type Finding = components["schemas"]["Finding"];
export type TaskResult = components["schemas"]["TaskResult"];
export type ScoreBand = components["schemas"]["ScoreBand"];
export type Share = components["schemas"]["ShareOut"];
export type SharedReport = components["schemas"]["SharedReportOut"];
export type TaskSlug = components["schemas"]["TaskOut"]["task"];
export type ScoredTask = TaskResult["task"];

/** Ascending, as the gauge draws them (SCREENING_SPEC §6.2). */
export const RISK_ORDER: readonly RiskClass[] = ["low", "moderate", "elevated", "high"];

/** The parent-facing game name for each scored task (messages: screening.activities.games). */
export const TASK_GAME = {
  rtn: "nameCall",
  joint_attention: "point",
  imitation: "copy",
  gaze_preference: "look",
  free_play: "freePlay",
} as const satisfies Record<ScoredTask, string>;

/** Setup-check threshold (SCREENING_SPEC §4.2): below it, the report says "not enough light". */
export const LOW_LIGHT_LUMA = 60;

export const resultPath = (screeningId: number) => `/screening/${screeningId}/result`;
export const resultsChatPath = (screeningId: number) => `/screening/${screeningId}/chat`;
export const parentReportPath = (screeningId: number) => `/screenings/${screeningId}/report`;
export const clinicianReportPath = (screeningId: number) => `/screenings/${screeningId}/clinician`;
export const sharePath = (token: string) => `/share/${token}`;

/** Findings name the child; a source that is an item id (q07) points at a questionnaire item. */
export function itemOf(report: Report, finding: Finding): ReportItem | undefined {
  return report.items.find((item) => item.item_id === finding.source);
}

/** Why a task wasn't counted, preferring what the parent can fix ("not enough light"). */
export function excludedReason(report: Report, task: TaskResult): string | null {
  const luma = report.tasks.find((t) => t.task === task.task)?.quality?.mean_luma;
  if (task.quality.reason !== "skipped" && luma != null && luma < LOW_LIGHT_LUMA) {
    return "low_light";
  }
  return task.quality.reason ?? null;
}
