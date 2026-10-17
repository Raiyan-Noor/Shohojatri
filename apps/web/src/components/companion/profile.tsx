"use client";

import { ArrowRight, Pencil, Sparkles } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { QueryView } from "@/components/app/query-view";
import { buttonClasses } from "@/components/ui/button";
import { useMe } from "@/lib/auth/session";
import { type ChildSummary } from "@/lib/children/queries";
import { type Answer, useCharacteristics, useQuestionnaire } from "@/lib/companion/queries";
import { Link } from "@/lib/i18n/navigation";

import { ChildPage, useDiagnosisLabel } from "./child-header";
import { useAnswerText, useBilingual, useQuestionText } from "./section-form";
import { SECTION_ICONS } from "./section-list";

/** The child's profile: diagnosis and characteristics, readable by the whole care team
 *  (COMPANION_SPEC §3.2 row 1–2); the parent edits each section. */
export function ChildProfile({ childId }: { childId: number }) {
  return <ChildPage childId={childId}>{(child) => <ProfileBody child={child} />}</ChildPage>;
}

function ProfileBody({ child }: { child: ChildSummary }) {
  const t = useTranslations("companion.profile");
  const format = useFormatter();
  const describe = useDiagnosisLabel();
  const label = useBilingual();
  const question = useQuestionText();
  const answerText = useAnswerText();
  const questionnaire = useQuestionnaire();
  const answers = useCharacteristics(child.id);
  const isParent = useMe().data?.role === "parent";
  const diagnosis = child.diagnosis;

  return (
    <div className="flex max-w-(--reading-max) flex-col gap-6">
      {isParent && child.status === "screening" && (
        <ActivateNudge
          childId={child.id}
          text={t("activateNudge", { name: child.name })}
          cta={t("activate")}
        />
      )}
      {isParent &&
        child.status === "companion" &&
        child.characteristics_done < child.characteristics_total && (
          <ActivateNudge
            childId={child.id}
            step="traits"
            text={t("traitsNudge", {
              done: child.characteristics_done,
              total: child.characteristics_total,
            })}
            cta={t("continueTraits")}
          />
        )}

      <section className="flex flex-col gap-2 rounded-lg border border-border-1 bg-white px-5 py-4">
        <div className="flex items-center gap-2">
          <h2 className="m-0 flex-1 font-display text-h3 font-bold text-text-1">
            {t("diagnosisTitle")}
          </h2>
          {isParent && diagnosis && (
            <Link
              href={`/children/${child.id}/activate?step=diagnosis`}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-pill px-3 text-small font-semibold text-navy hover:bg-navy-50"
            >
              <Pencil aria-hidden className="size-4" />
              {t("edit")}
            </Link>
          )}
        </div>
        {diagnosis ? (
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[15px]">
            <dt className="text-text-2">{t("what")}</dt>
            <dd className="m-0 text-text-1">{describe(diagnosis)}</dd>
            {diagnosis.diagnosed_on && (
              <>
                <dt className="text-text-2">{t("when")}</dt>
                <dd className="m-0 text-text-1">
                  {format.dateTime(new Date(`${diagnosis.diagnosed_on}-01T00:00:00+06:00`), {
                    year: "numeric",
                    month: "long",
                  })}
                </dd>
              </>
            )}
            {diagnosis.diagnosed_by && (
              <>
                <dt className="text-text-2">{t("by")}</dt>
                <dd className="m-0 text-text-1">{diagnosis.diagnosed_by}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="m-0 text-[15px] text-text-2">{t("noDiagnosis")}</p>
        )}
      </section>

      <QueryView query={questionnaire}>
        {(q) => (
          <QueryView query={answers}>
            {(a) => (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="m-0 font-display text-h2 font-bold text-text-1">
                    {t("traitsTitle")}
                  </h2>
                  {a.updated_at && (
                    <span className="text-caption text-text-3">
                      {t("updated", {
                        date: format.dateTime(new Date(a.updated_at), { dateStyle: "medium" }),
                        version: a.version,
                      })}
                    </span>
                  )}
                </div>
                {q.sections.map((section) => {
                  const saved = a.sections[section.id] as Record<string, Answer> | undefined;
                  const Icon = SECTION_ICONS[section.id] ?? Sparkles;
                  const rows = section.questions.filter((qq) => saved?.[qq.id] !== undefined);
                  return (
                    <section
                      key={section.id}
                      className="flex flex-col gap-2 rounded-lg border border-border-1 bg-white px-5 py-4"
                    >
                      <div className="flex items-center gap-2">
                        <Icon aria-hidden className="size-5 text-teal-ink" />
                        <h3 className="m-0 flex-1 text-body font-bold text-text-1">
                          {label({ en: section.title_en, bn: section.title_bn })}
                        </h3>
                        {isParent && (
                          <Link
                            href={`/children/${child.id}/profile/edit?section=${section.id}`}
                            className="inline-flex min-h-10 items-center gap-1.5 rounded-pill px-3 text-small font-semibold text-navy hover:bg-navy-50"
                          >
                            <Pencil aria-hidden className="size-4" />
                            {saved ? t("edit") : t("fill")}
                          </Link>
                        )}
                      </div>
                      {rows.length === 0 ? (
                        <p className="m-0 text-[15px] text-text-3">
                          {saved ? t("nothing") : t("notYet")}
                        </p>
                      ) : (
                        <dl className="m-0 flex flex-col gap-2">
                          {rows.map((qq) => (
                            <div key={qq.id}>
                              <dt className="text-small text-text-2">{question(qq)}</dt>
                              <dd className="m-0 text-[15px] whitespace-pre-line text-text-1">
                                {answerText(qq, saved![qq.id])}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </QueryView>
        )}
      </QueryView>
    </div>
  );
}

function ActivateNudge({
  childId,
  step,
  text,
  cta,
}: {
  childId: number;
  step?: string;
  text: string;
  cta: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-amber-50 px-5 py-4 sm:flex-row sm:items-center">
      <p className="m-0 flex-1 text-[15px] text-text-1">{text}</p>
      <Link
        href={`/children/${childId}/activate${step ? `?step=${step}` : ""}`}
        className={buttonClasses({ size: "sm" })}
      >
        {cta}
        <ArrowRight aria-hidden className="size-4" />
      </Link>
    </div>
  );
}
