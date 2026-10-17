"use client";

import {
  ArrowRight,
  Calendar,
  Check,
  CircleCheck,
  Clock,
  NotebookPen,
  Stethoscope,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { QueryView } from "@/components/app/query-view";
import { FormAlert } from "@/components/auth/auth-screen";
import { CareTeamList } from "@/components/care-team/care-team-list";
import { ChildIdPanel } from "@/components/care-team/child-id-panel";
import { Button, buttonClasses } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ChoiceGroup } from "@/components/ui/choice-group";
import { Stepper } from "@/components/ui/stepper";
import { TextField } from "@/components/ui/text-field";
import { ApiRequestError } from "@/lib/api/client";
import { useErrorMessage } from "@/lib/api/error-message";
import { useMe } from "@/lib/auth/session";
import { useGrants } from "@/lib/care-team/queries";
import { type ChildSummary, useChild } from "@/lib/children/queries";
import {
  type Diagnosis,
  type DiagnosisKind,
  type Questionnaire,
  type SectionAnswers,
  useActivate,
  useCharacteristics,
  useQuestionnaire,
  useSaveSection,
} from "@/lib/companion/queries";
import { todayInBangladesh } from "@/lib/dates";
import { Link, useRouter } from "@/lib/i18n/navigation";

import { useDiagnosisLabel } from "./child-header";
import { SectionForm, useBilingual } from "./section-form";
import { SectionList } from "./section-list";

export type WizardStep = "diagnosis" | "traits" | "section" | "team" | "done";
const STEPS = ["diagnosis", "traits", "team"] as const;
const KINDS: DiagnosisKind[] = ["autism", "autism_plus", "other_condition", "being_assessed"];

/** "My child has been assessed" (COMPANION_SPEC §1, design W2–W5): diagnosis details, the
 *  characteristics questionnaire, then the care team with the Child ID. Works for a screened
 *  child and for one added straight to the companion. */
export function ActivationWizard({
  childId,
  step,
  section,
}: {
  childId: number;
  step: WizardStep;
  section?: string;
}) {
  const t = useTranslations("companion.wizard");
  const child = useChild(childId);
  const router = useRouter();
  const go = (next: WizardStep, nextSection?: string) =>
    router.push(
      `/children/${childId}/activate?step=${next}${nextSection ? `&section=${nextSection}` : ""}`,
    );
  // The stepper's three steps; a single section counts as "traits", and "done" isn't shown.
  const index = Math.max(
    0,
    STEPS.indexOf(step === "section" ? "traits" : (step as (typeof STEPS)[number])),
  );

  return (
    <div className="mx-auto flex w-full max-w-(--reading-max) flex-col gap-6">
      {step !== "done" && (
        <Stepper
          steps={STEPS.map((s) => t(`steps.${s}`))}
          current={index}
          countLabel={t("stepCount", { step: index + 1, total: STEPS.length })}
        />
      )}
      <QueryView query={child}>
        {(data) => {
          switch (step) {
            case "diagnosis":
              return <DiagnosisStep child={data} onDone={() => go("traits")} />;
            case "traits":
              return (
                <TraitsStep
                  child={data}
                  onOpen={(id) => go("section", id)}
                  onLater={() => go("team")}
                />
              );
            case "section":
              return (
                <SectionStep
                  child={data}
                  sectionId={section}
                  onNext={(next) => (next ? go("section", next) : go("team"))}
                  onBack={() => go("traits")}
                />
              );
            case "team":
              return <TeamStep child={data} onDone={() => go("done")} />;
            case "done":
              return <DoneStep child={data} />;
          }
        }}
      </QueryView>
    </div>
  );
}

function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h1 className="m-0 font-display text-h1 font-bold text-text-1">{title}</h1>
      {subtitle && <p className="mt-1 mb-0 text-body text-text-2">{subtitle}</p>}
    </div>
  );
}

function DiagnosisStep({ child, onDone }: { child: ChildSummary; onDone: () => void }) {
  const t = useTranslations("companion.diagnosis");
  const tCommon = useTranslations("common");
  const errorMessage = useErrorMessage();
  const activate = useActivate(child.id);
  const grants = useGrants(child.id);
  const kindLabel = useId();
  const saved = child.diagnosis;
  const [kind, setKind] = useState<DiagnosisKind | null>(saved?.kind ?? null);
  const [condition, setCondition] = useState(saved?.condition_text ?? "");
  const [date, setDate] = useState(saved?.diagnosed_on ?? "");
  const [by, setBy] = useState(saved?.diagnosed_by ?? "");
  const [byUser, setByUser] = useState<number | null>(saved?.diagnosed_by_user_id ?? null);
  const [missing, setMissing] = useState(false);
  const specialists = (grants.data ?? []).filter((g) => g.scope === "clinical");
  const needsCondition = kind === "autism_plus" || kind === "other_condition";
  const error = activate.error instanceof ApiRequestError ? activate.error : null;
  const fieldError = (field: string) => (error?.field === field ? errorMessage(error) : undefined);

  const submit = () => {
    if (!kind || (needsCondition && !condition.trim())) {
      setMissing(true);
      return;
    }
    const body: Diagnosis = {
      kind,
      condition_text: needsCondition ? condition.trim() : null,
      diagnosed_on: date || null,
      diagnosed_by: byUser ? null : by.trim() || null,
      diagnosed_by_user_id: byUser,
    };
    activate.mutate(body, { onSuccess: onDone });
  };

  return (
    <div className="flex flex-col gap-6">
      <Heading title={t("title")} subtitle={t("subtitle", { name: child.name })} />
      <div className="flex flex-col gap-2.5">
        <span id={kindLabel} className="text-[17px] font-semibold text-text-1">
          {t("kind")}
        </span>
        <ChoiceGroup
          name="diagnosis-kind"
          labelledBy={kindLabel}
          value={kind}
          onChange={(value) => setKind(value as DiagnosisKind)}
          options={KINDS.map((value) => ({ value, label: t(`kinds.${value}`) }))}
        />
        {missing && !kind && <FormAlert message={t("kindRequired")} />}
      </div>
      {needsCondition && (
        <TextField
          label={t("condition")}
          placeholder={t("conditionPlaceholder")}
          maxLength={200}
          value={condition}
          onChange={(event) => setCondition(event.target.value)}
          error={missing && !condition.trim() ? t("conditionRequired") : undefined}
        />
      )}
      <TextField
        label={t("when")}
        optionalLabel={tCommon("optional")}
        type="month"
        icon={Calendar}
        min={child.dob.slice(0, 7)}
        max={todayInBangladesh().slice(0, 7)}
        value={date}
        onChange={(event) => setDate(event.target.value)}
        error={fieldError("diagnosed_on")}
      />
      <div className="flex flex-col gap-2.5">
        <TextField
          label={t("by")}
          optionalLabel={tCommon("optional")}
          icon={Stethoscope}
          placeholder={t("byPlaceholder")}
          maxLength={200}
          value={by}
          onChange={(event) => {
            setBy(event.target.value);
            setByUser(null);
          }}
          error={fieldError("diagnosed_by")}
        />
        {specialists.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-small text-text-2">{t("byTeam")}</span>
            <div className="flex flex-wrap gap-2">
              {specialists.map((grant) => (
                <Chip
                  key={grant.id}
                  label={grant.member.name}
                  selected={byUser === grant.member.id}
                  onToggle={() => {
                    const on = byUser === grant.member.id;
                    setByUser(on ? null : grant.member.id);
                    setBy(on ? "" : grant.member.name);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <p className="m-0 text-small text-text-3">{t("reportLater")}</p>
      {error && !error.field && <FormAlert message={errorMessage(error)} />}
      <Button
        size="lg"
        iconRight={ArrowRight}
        loading={activate.isPending}
        onClick={submit}
        className="self-start"
      >
        {t("next")}
      </Button>
    </div>
  );
}

function TraitsStep({
  child,
  onOpen,
  onLater,
}: {
  child: ChildSummary;
  onOpen: (section: string) => void;
  onLater: () => void;
}) {
  const t = useTranslations("companion.wizard");
  const questionnaire = useQuestionnaire();
  const answers = useCharacteristics(child.id);
  return (
    <div className="flex flex-col gap-6">
      <Heading title={t("traitsTitle", { name: child.name })} subtitle={t("traitsSubtitle")} />
      <p className="m-0 rounded-md bg-sky-50 px-4 py-3 text-[15px] text-text-1">
        {t("noWrongAnswers")}
      </p>
      <QueryView query={questionnaire}>
        {(q) => (
          <QueryView query={answers}>
            {(a) => {
              const next = q.sections.find((s) => !(s.id in a.sections));
              return (
                <div className="flex flex-col gap-4">
                  <SectionList
                    questionnaire={q}
                    done={a.sections}
                    current={next?.id}
                    onOpen={onOpen}
                  />
                  {next && (
                    <Button
                      size="lg"
                      iconRight={ArrowRight}
                      onClick={() => onOpen(next.id)}
                      className="self-start"
                    >
                      {Object.keys(a.sections).length === 0
                        ? t("startTraits")
                        : t("continueTraits")}
                    </Button>
                  )}
                  <Button
                    variant={next ? "ghost" : "primary"}
                    size="lg"
                    onClick={onLater}
                    className="self-start"
                  >
                    {next ? t("traitsLater") : t("next")}
                  </Button>
                </div>
              );
            }}
          </QueryView>
        )}
      </QueryView>
    </div>
  );
}

/** One questionnaire section; saves on "Next", or skips it. Also used to edit from the profile. */
export function SectionStep({
  child,
  sectionId,
  onNext,
  onBack,
  editing = false,
}: {
  child: ChildSummary;
  sectionId?: string;
  onNext: (nextSection: string | null) => void;
  onBack: () => void;
  editing?: boolean;
}) {
  const questionnaire = useQuestionnaire();
  const answers = useCharacteristics(child.id);
  return (
    <QueryView query={questionnaire}>
      {(q) => (
        <QueryView query={answers}>
          {(a) => {
            const index = q.sections.findIndex((s) => s.id === sectionId);
            if (index < 0) return null;
            return (
              <SectionEditor
                key={sectionId}
                child={child}
                questionnaire={q}
                index={index}
                initial={(a.sections[q.sections[index].id] as SectionAnswers | undefined) ?? {}}
                onNext={onNext}
                onBack={onBack}
                editing={editing}
              />
            );
          }}
        </QueryView>
      )}
    </QueryView>
  );
}

function SectionEditor({
  child,
  questionnaire,
  index,
  initial,
  onNext,
  onBack,
  editing,
}: {
  child: ChildSummary;
  questionnaire: Questionnaire;
  index: number;
  initial: SectionAnswers;
  onNext: (nextSection: string | null) => void;
  onBack: () => void;
  editing: boolean;
}) {
  const t = useTranslations("companion.wizard");
  const errorMessage = useErrorMessage();
  const label = useBilingual();
  const save = useSaveSection(child.id);
  const [answers, setAnswers] = useState(initial);
  const section = questionnaire.sections[index];
  const next = editing ? null : (questionnaire.sections[index + 1]?.id ?? null);
  const error = save.error instanceof ApiRequestError ? save.error : null;
  const total = questionnaire.sections.length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="m-0 text-small font-semibold text-text-2">
          {t("sectionCount", { n: index + 1, total })}
        </p>
        <h1 className="m-0 font-display text-h1 font-bold text-text-1">
          {label({ en: section.title_en, bn: section.title_bn })}
        </h1>
      </div>
      <SectionForm
        section={section}
        answers={answers}
        onChange={setAnswers}
        errorField={error?.field}
        errorMessage={error ? errorMessage(error) : undefined}
      />
      {error && !error.field && <FormAlert message={errorMessage(error)} />}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          size="lg"
          icon={editing ? Check : undefined}
          iconRight={editing ? undefined : ArrowRight}
          loading={save.isPending}
          onClick={() =>
            save.mutate({ section: section.id, answers }, { onSuccess: () => onNext(next) })
          }
        >
          {editing ? t("saveSection") : next ? t("nextSection") : t("finishTraits")}
        </Button>
        <Button size="lg" variant="ghost" onClick={editing ? onBack : () => onNext(next)}>
          {editing ? t("cancel") : t("skipSection")}
        </Button>
      </div>
      {!editing && (
        <button
          type="button"
          onClick={onBack}
          className="min-h-10 cursor-pointer self-start rounded-sm text-small font-semibold text-text-link hover:underline"
        >
          {t("allSections")}
        </button>
      )}
    </div>
  );
}

function TeamStep({ child, onDone }: { child: ChildSummary; onDone: () => void }) {
  const t = useTranslations("companion.wizard");
  const grants = useGrants(child.id);
  const me = useMe().data;
  if (!me || !child.code) return null;
  return (
    <div className="flex flex-col gap-6">
      <Heading title={t("teamTitle")} subtitle={t("teamSubtitle")} />
      <ChildIdPanel childId={child.id} name={child.name} code={child.code} />
      <section className="flex flex-col gap-3">
        <h2 className="m-0 flex items-center gap-2 font-display text-[19px] font-bold text-text-1">
          <Users aria-hidden className="size-5 text-navy" />
          {t("team")}
        </h2>
        <QueryView query={grants}>
          {(list) => <CareTeamList parentName={me.name} childName={child.name} grants={list} />}
        </QueryView>
        {child.pending_requests > 0 && (
          <Link href={`/children/${child.id}/care-team`} className="font-semibold text-text-link">
            {t("pending", { count: child.pending_requests })}
          </Link>
        )}
      </section>
      <Button size="lg" iconRight={ArrowRight} onClick={onDone} className="self-start">
        {t("finish")}
      </Button>
    </div>
  );
}

function DoneStep({ child }: { child: ChildSummary }) {
  const t = useTranslations("companion.wizard");
  const describe = useDiagnosisLabel();
  const items = [
    {
      done: Boolean(child.diagnosis),
      text: child.diagnosis ? describe(child.diagnosis) : t("doneNoDiagnosis"),
    },
    {
      done: child.characteristics_done === child.characteristics_total,
      text: t("doneTraits", {
        done: child.characteristics_done,
        total: child.characteristics_total,
      }),
    },
    { done: true, text: t("doneCode", { code: child.code ?? "" }) },
  ];
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm">
      {/* The brand gradient, used sparingly (CLAUDE.md §7); white text on it would be too faint. */}
      <div aria-hidden className="h-3 bg-(image:--sj-gradient-journey)" />
      <div className="flex flex-col gap-6 px-6 py-8">
        <h1 className="m-0 font-display text-h1 font-bold text-text-1">
          {t("doneTitle", { name: child.name })}
        </h1>
        <p className="m-0 text-body text-text-2">{t("doneSubtitle")}</p>
        <ul className="m-0 flex list-none flex-col gap-2 rounded-lg bg-n-50 p-4 text-text-1">
          {items.map(({ done, text }) => (
            <li key={text} className="flex items-center gap-2">
              {done ? (
                <CircleCheck aria-hidden className="size-5 text-leaf-ink" />
              ) : (
                <Clock aria-hidden className="size-5 text-amber-ink" />
              )}
              {text}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-3">
          <Link href={`/children/${child.id}/timeline`} className={buttonClasses({ size: "lg" })}>
            {t("seeTimeline", { name: child.name })}
            <ArrowRight aria-hidden className="size-5" />
          </Link>
          <Link
            href={`/children/${child.id}/logs/new`}
            className={buttonClasses({ variant: "secondary", size: "lg" })}
          >
            <NotebookPen aria-hidden className="size-5" />
            {t("firstLog")}
          </Link>
        </div>
      </div>
    </div>
  );
}
