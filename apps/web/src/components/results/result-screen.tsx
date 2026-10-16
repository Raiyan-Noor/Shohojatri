"use client";

import {
  FileText,
  Footprints,
  Lightbulb,
  MapPin,
  MessageCircleQuestion,
  Search,
  Send,
  Star,
  Stethoscope,
  X,
  type LucideIcon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";

import { QueryView } from "@/components/app/query-view";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StateView } from "@/components/ui/state-view";
import { Link, useRouter } from "@/lib/i18n/navigation";
import { useScreening, useScreeningReport } from "@/lib/screening/queries";
import {
  clinicianReportPath,
  parentReportPath,
  type Report,
  resultsChatPath,
} from "@/lib/screening/results";
import { resumePath } from "@/lib/screening/rules";

import {
  ConfidenceNote,
  DemoBanner,
  FindingRows,
  NotDiagnosis,
  ResultGauge,
  StrengthList,
  useHeadline,
  useNextSteps,
} from "./result-parts";
import { ShareSheet } from "./share-sheet";
import { useResultText } from "./use-result-text";

/** `/screening/[id]/result` (design Results R1-R4): the parent's result after finalize. */
export function ResultScreen({ screeningId }: { screeningId: number }) {
  const screening = useScreening(screeningId);
  const router = useRouter();
  const unfinished = screening.data && screening.data.status !== "finalized";

  useEffect(() => {
    if (screening.data && unfinished) router.replace(resumePath(screening.data));
  }, [screening.data, unfinished, router]);

  if (unfinished) return <StateView kind="loading" />;
  return (
    <QueryView query={screening}>{() => <ResultReport screeningId={screeningId} />}</QueryView>
  );
}

function ResultReport({ screeningId }: { screeningId: number }) {
  const query = useScreeningReport(screeningId, "parent");
  return <QueryView query={query}>{(report) => <ResultBody report={report} />}</QueryView>;
}

function ResultBody({ report }: { report: Report }) {
  const t = useTranslations("results");
  const format = useFormatter();
  const text = useResultText(report);
  const { headline, meaning, support } = useHeadline(report);
  const steps = useNextSteps(report);
  const [sharing, setSharing] = useState(false);
  const level = report.result.risk_class;
  // Moderate and above: sharing with a doctor and finding a specialist come first (§6.2).
  const prominent = level !== null && level !== "low";

  return (
    <div className="mx-auto flex w-full max-w-(--reading-max) flex-col gap-5">
      <div className="flex items-center gap-1">
        <Link
          href="/home"
          aria-label={t("actions.home")}
          className="-ml-3 flex size-12 items-center justify-center rounded-full text-navy hover:bg-navy-50"
        >
          <X aria-hidden className="size-5.5" />
        </Link>
        <h1 className="m-0 flex-1 text-center font-display text-h3 font-bold text-text-1">
          {t("title", { name: text.name })}
        </h1>
        <span className="w-9" />
      </div>

      <DemoBanner report={report} />

      <section className="flex flex-col items-center gap-3 rounded-leaf border border-navy-100 bg-(image:--sj-gradient-sky) px-5 pt-5 pb-6 text-center">
        <p className="m-0 text-small text-text-2">
          {t("meta", { name: text.name, age: text.age, date: text.date })}
        </p>
        <ResultGauge report={report} width={230} />
        <h2 className="m-0 font-display text-h2 leading-[1.4] font-bold text-balance text-navy">
          {headline}
        </h2>
        {report.result.score != null && (
          <p className="m-0 max-w-[40ch] text-small text-text-2">{t("scoreNote")}</p>
        )}
        {support && (
          <p className="m-0 max-w-[44ch] font-semibold text-pretty text-leaf-ink">{support}</p>
        )}
      </section>

      <Card className="flex flex-col gap-3">
        <SectionTitle icon={Lightbulb}>{t("sections.meaning")}</SectionTitle>
        <p className="m-0 leading-[1.7] text-pretty">{meaning}</p>
        <NotDiagnosis className="text-[15px]" />
      </Card>

      <Section icon={Search} title={t("sections.noticed")}>
        <FindingRows report={report} findings={report.result.top_concerns} />
      </Section>

      {report.result.strengths.length > 0 && (
        <Section icon={Star} title={t("sections.wentWell")}>
          <StrengthList report={report} />
        </Section>
      )}

      <Section icon={Footprints} title={t("sections.next")}>
        <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
          {steps.map((step, index) => (
            <li key={step} className="flex items-start gap-3 leading-[1.6]">
              <span className="flex size-6.5 shrink-0 items-center justify-center rounded-full bg-navy-50 font-display text-small font-bold text-navy">
                {format.number(index + 1)}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </Section>

      <ConfidenceNote report={report} />

      <div className="flex flex-col gap-2.5">
        <Button
          size="lg"
          block
          icon={Send}
          variant={prominent ? "primary" : "secondary"}
          onClick={() => setSharing(true)}
        >
          {t("actions.share")}
        </Button>
        {/* Not built in this phase; shown so the parent knows it's coming. */}
        <Soon icon={MapPin} label={t("actions.specialists")} />
        <Link
          href={resultsChatPath(report.screening_id)}
          className={buttonClasses({ variant: "secondary", block: true })}
        >
          <MessageCircleQuestion aria-hidden className="size-5" />
          {t("actions.chat")}
        </Link>
      </div>

      <div className="flex flex-col gap-1 border-t border-border-1 pt-4">
        <Link
          href={parentReportPath(report.screening_id)}
          className={buttonClasses({ variant: "ghost", block: true })}
        >
          <FileText aria-hidden className="size-5" />
          {t("actions.parentReport")}
        </Link>
        <Link
          href={clinicianReportPath(report.screening_id)}
          className={buttonClasses({ variant: "ghost", block: true })}
        >
          <Stethoscope aria-hidden className="size-5" />
          {t("actions.doctorReport")}
        </Link>
      </div>

      <p className="m-0 text-center text-caption text-text-3">
        {t("reportNo", { no: report.report_no })}
      </p>

      <ShareSheet
        screeningId={report.screening_id}
        childName={text.name}
        open={sharing}
        onClose={() => setSharing(false)}
      />
    </div>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <h2 className="m-0 flex items-center gap-2 font-display text-[19px] font-bold text-navy">
      <Icon aria-hidden className="size-5" />
      {children}
    </h2>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle icon={icon}>{title}</SectionTitle>
      {children}
    </section>
  );
}

function Soon({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  const t = useTranslations("results.actions");
  return (
    <div className="flex min-h-12 items-center justify-center gap-2 rounded-pill border-[1.5px] border-dashed border-border-2 px-5 text-center font-semibold text-text-3">
      <Icon aria-hidden className="size-5" />
      <span>
        {label} · <span className="font-normal">{t("soon")}</span>
      </span>
    </div>
  );
}
