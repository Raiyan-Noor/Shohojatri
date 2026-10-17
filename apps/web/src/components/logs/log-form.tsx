"use client";

import { Calendar, Check, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { useForm, useWatch } from "react-hook-form";

import { FormAlert } from "@/components/auth/auth-screen";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ChipOption } from "@/components/ui/chip-option";
import { TextAreaField, TextField } from "@/components/ui/text-field";
import { useErrorMessage } from "@/lib/api/error-message";
import { showApiError } from "@/lib/api/form-errors";
import { useMe } from "@/lib/auth/session";
import { useGoals } from "@/lib/companion/queries";
import { fromBdLocalInput, toBdLocalInput } from "@/lib/dates";
import { useRouter } from "@/lib/i18n/navigation";
import {
  type AuthorRole,
  type GoalProgress,
  type LogDomain,
  type LogEntry,
  type LogType,
  type LogVisibility,
  useCreateLog,
  useUpdateLog,
} from "@/lib/logs/queries";

import { FaceRating } from "./face-rating";
import { DEFAULT_TYPE, DOMAINS, GOAL_PROGRESS, TYPES_FOR, VISIBILITIES_FOR } from "./log-meta";

type Mode =
  { kind: "new" } | { kind: "correct"; original: LogEntry } | { kind: "edit"; entry: LogEntry };

type Values = {
  type: LogType;
  occurred_at: string; // datetime-local, Bangladesh time
  domains: LogDomain[];
  rating: number | null;
  text: string;
  goal_id: string; // "" = none
  goal_progress: GoalProgress | null;
  mood: number | null;
  visibility: LogVisibility;
};

/** The full log form (COMPANION_SPEC §5.1): new entry, edit within 24 h, or a correction. Teachers
 *  and specialists start from their role's template prompt. */
export function LogForm({ childId, mode }: { childId: number; mode: Mode }) {
  const t = useTranslations("logs.form");
  const tLogs = useTranslations("logs");
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const me = useMe().data;
  const goals = useGoals(childId);
  const create = useCreateLog(childId);
  const update = useUpdateLog(childId);
  const ids = { rating: useId(), mood: useId(), goal: useId() };
  const role = (me?.role ?? "parent") as AuthorRole;
  const source = mode.kind === "edit" ? mode.entry : mode.kind === "correct" ? mode.original : null;

  const form = useForm<Values>({
    defaultValues: source
      ? {
          type: source.type,
          occurred_at: toBdLocalInput(mode.kind === "edit" ? source.occurred_at : new Date()),
          domains: source.domains,
          rating: Object.values(source.ratings)[0] ?? null,
          text: source.text ?? "",
          goal_id: source.goal ? String(source.goal.id) : "",
          goal_progress: source.goal_progress,
          mood: source.mood,
          visibility: source.visibility,
        }
      : {
          type: DEFAULT_TYPE[role],
          occurred_at: toBdLocalInput(new Date()),
          domains: [],
          rating: null,
          text: role === "parent" ? "" : tLogs(`templates.${role}`),
          goal_id: "",
          goal_progress: null,
          mood: null,
          visibility: "care_team",
        },
  });
  const values = useWatch({ control: form.control }) as Values;
  const { errors, isSubmitting } = form.formState;
  if (!me) return null;

  const types = TYPES_FOR[role].includes(values.type)
    ? TYPES_FOR[role]
    : [...TYPES_FOR[role], values.type];
  const activeGoals = (goals.data ?? []).filter(
    (goal) => goal.status === "active" || String(goal.id) === values.goal_id,
  );

  const onSubmit = form.handleSubmit(async (v) => {
    const text = v.text.trim();
    if (!text && v.domains.length === 0) {
      form.setError("text", { type: "required", message: t("emptyError") });
      return;
    }
    if (v.goal_id && !v.goal_progress) {
      form.setError("goal_progress", { type: "required", message: t("progressError") });
      return;
    }
    const rating = v.rating;
    const content = {
      type: v.type,
      occurred_at: fromBdLocalInput(v.occurred_at),
      domains: v.domains,
      ratings: rating ? Object.fromEntries(v.domains.map((d) => [d, rating])) : {},
      text: text || null,
      goal_id: v.goal_id ? Number(v.goal_id) : null,
      goal_progress: v.goal_id ? v.goal_progress : null,
      mood: v.mood,
      visibility: v.visibility,
    };
    try {
      if (mode.kind === "edit") {
        await update.mutateAsync({ id: mode.entry.id, body: content });
      } else {
        await create.mutateAsync({
          ...content,
          corrects_log_id: mode.kind === "correct" ? mode.original.id : null,
        });
      }
      router.push(`/children/${childId}/timeline`);
    } catch (error) {
      showApiError(error, form.setError, errorMessage(error), { ratings: "rating" });
    }
  });

  const toggleDomain = (domain: LogDomain) =>
    form.setValue(
      "domains",
      values.domains.includes(domain)
        ? values.domains.filter((d) => d !== domain)
        : [...values.domains, domain],
    );

  return (
    <form noValidate onSubmit={onSubmit} className="flex max-w-(--reading-max) flex-col gap-6">
      {mode.kind === "correct" && (
        <p className="m-0 rounded-md bg-sky-50 px-4 py-3 text-[15px] text-text-1">
          {t("correctionNote")}
        </p>
      )}

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 p-0 text-[15px] font-semibold text-text-1">{t("type")}</legend>
        <div className="flex flex-wrap gap-2">
          {types.map((type) => (
            <ChipOption
              key={type}
              label={tLogs(`types.${type}`)}
              value={type}
              selected={values.type === type}
              {...form.register("type")}
            />
          ))}
        </div>
      </fieldset>

      <TextField
        label={t("when")}
        type="datetime-local"
        icon={Calendar}
        max={toBdLocalInput(new Date())}
        error={errors.occurred_at?.message}
        {...form.register("occurred_at", { required: true })}
      />

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 p-0 text-[15px] font-semibold text-text-1">{t("domains")}</legend>
        <div className="flex flex-wrap gap-2">
          {DOMAINS.map(({ id, icon }) => (
            <Chip
              key={id}
              label={tLogs(`domains.${id}`)}
              icon={icon}
              selected={values.domains.includes(id)}
              onToggle={() => toggleDomain(id)}
            />
          ))}
        </div>
      </fieldset>

      {values.domains.length > 0 && (
        <div className="flex flex-col gap-2">
          <span id={ids.rating} className="text-[15px] font-semibold text-text-1">
            {t("rating")}{" "}
            <span className="text-small font-normal text-text-3">{t("optional")}</span>
          </span>
          <FaceRating
            labelledBy={ids.rating}
            value={values.rating}
            onChange={(rating) => form.setValue("rating", rating)}
          />
          {errors.rating && <FormAlert message={errors.rating.message} />}
        </div>
      )}

      <TextAreaField
        label={t("text")}
        hint={role === "parent" ? t("textHint") : t("templateHint")}
        rows={role === "parent" ? 4 : 7}
        maxLength={4000}
        error={errors.text?.message}
        {...form.register("text")}
      />

      {activeGoals.length > 0 && (
        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <legend className="mb-1 p-0 text-[15px] font-semibold text-text-1">
            {t("goal")} <span className="text-small font-normal text-text-3">{t("optional")}</span>
          </legend>
          <select
            aria-label={t("goal")}
            className="min-h-13 rounded-md border-[1.5px] border-border-2 bg-white px-4 text-body text-text-1"
            {...form.register("goal_id")}
          >
            <option value="">{t("noGoal")}</option>
            {activeGoals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.title}
              </option>
            ))}
          </select>
          {values.goal_id && (
            <div role="radiogroup" aria-label={t("progress")} className="flex flex-wrap gap-2">
              {GOAL_PROGRESS.map((progress) => (
                <ChipOption
                  key={progress}
                  label={tLogs(`progress.${progress}`)}
                  value={progress}
                  selected={values.goal_progress === progress}
                  {...form.register("goal_progress")}
                />
              ))}
            </div>
          )}
          {errors.goal_progress && <FormAlert message={errors.goal_progress.message} />}
        </fieldset>
      )}

      <div className="flex flex-col gap-2">
        <span id={ids.mood} className="text-[15px] font-semibold text-text-1">
          {t("mood")} <span className="text-small font-normal text-text-3">{t("optional")}</span>
        </span>
        <FaceRating
          scale="mood"
          labelledBy={ids.mood}
          value={values.mood}
          onChange={(mood) => form.setValue("mood", mood)}
        />
      </div>

      {mode.kind === "correct" || (mode.kind === "edit" && mode.entry.corrects_log_id) ? (
        <p className="m-0 flex items-center gap-1.5 text-small text-text-2">
          <Lock aria-hidden className="size-4" />
          {t("sameVisibility")}
        </p>
      ) : (
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[15px] font-semibold text-text-1">
            {t("visibility")}
          </legend>
          <div className="flex flex-wrap gap-2">
            {VISIBILITIES_FOR[role].map((visibility) => (
              <ChipOption
                key={visibility}
                label={tLogs(`visibility.${visibility}.label`)}
                value={visibility}
                selected={values.visibility === visibility}
                {...form.register("visibility")}
              />
            ))}
          </div>
          <p className="m-0 text-small text-text-3">
            {tLogs(`visibility.${values.visibility}.${role === "parent" ? "hint" : "hintMember"}`)}
          </p>
          {errors.visibility && <FormAlert message={errors.visibility.message} />}
        </fieldset>
      )}

      <FormAlert message={errors.root?.message} />
      <Button type="submit" size="lg" icon={Check} loading={isSubmitting} className="self-start">
        {mode.kind === "edit"
          ? t("saveEdit")
          : mode.kind === "correct"
            ? t("saveCorrection")
            : t("save")}
      </Button>
    </form>
  );
}
