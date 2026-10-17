"use client";

import { ArrowLeft, NotebookPen } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { QueryView } from "@/components/app/query-view";
import { AskFab, chatPath } from "@/components/chat/ask-links";
import { ChildCode } from "@/components/children/child-code";
import { Avatar } from "@/components/ui/avatar";
import { buttonClasses } from "@/components/ui/button";
import { homePathFor, useMe } from "@/lib/auth/session";
import { type ChildSummary, useChild, useFormatAge } from "@/lib/children/queries";
import { cx } from "@/lib/cx";
import { Link, usePathname } from "@/lib/i18n/navigation";

type Tab = "timeline" | "profile" | "chat" | "care-team";

/** Header of a child's pages (design `Desk` head + tabs). B13 adds the remaining dashboard tabs;
 *  this links the ones that exist. Children render once the child has loaded. */
export function ChildPage({
  childId,
  children,
}: {
  childId: number;
  children: (child: ChildSummary) => ReactNode;
}) {
  const t = useTranslations("companion.header");
  const formatAge = useFormatAge();
  const describe = useDiagnosisLabel();
  const child = useChild(childId);
  const me = useMe().data;
  const pathname = usePathname();
  if (!me) return null;

  const tabs: Tab[] =
    me.role === "parent"
      ? ["timeline", "profile", "chat", "care-team"]
      : ["timeline", "profile", "chat"];
  const addLabel = {
    parent: t("addParent"),
    teacher: t("addTeacher"),
    specialist: t("addSpecialist"),
  };

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={homePathFor(me)}
        className="inline-flex min-h-12 items-center gap-2 self-start font-semibold text-text-link hover:underline"
      >
        <ArrowLeft aria-hidden className="size-5" />
        {t("back")}
      </Link>
      <QueryView query={child}>
        {(data) => (
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-4">
              <Avatar name={data.name} size={64} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <h1 className="m-0 font-display text-h1 font-bold text-text-1">{data.name}</h1>
                <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-text-2">
                  <span>{formatAge(data.age_months)}</span>
                  {data.diagnosis && (
                    <>
                      <span aria-hidden>·</span>
                      <span>{describe(data.diagnosis)}</span>
                    </>
                  )}
                  {data.code && <ChildCode code={data.code} />}
                </p>
              </div>
              {me.role !== "admin" && (
                <Link
                  href={`/children/${childId}/logs/new`}
                  className={buttonClasses({ size: "md" })}
                >
                  <NotebookPen aria-hidden className="size-5" />
                  {addLabel[me.role]}
                </Link>
              )}
            </div>
            <nav aria-label={t("tabsLabel")} className="-mx-1 overflow-x-auto">
              <ul className="m-0 flex list-none gap-1 border-b border-border-1 p-0 px-1">
                {tabs.map((tab) => {
                  const href = `/children/${childId}/${tab}`;
                  const active = pathname.startsWith(href);
                  return (
                    <li key={tab}>
                      <Link
                        href={href}
                        aria-current={active ? "page" : undefined}
                        className={cx(
                          "-mb-px inline-flex min-h-12 items-center border-b-[3px] px-3.5 font-semibold whitespace-nowrap no-underline",
                          active
                            ? "border-navy text-navy"
                            : "border-transparent text-text-2 hover:text-navy",
                        )}
                      >
                        {t(`tabs.${tab}`)}
                        {tab === "care-team" && data.pending_requests > 0 && (
                          <span className="ml-1.5 rounded-pill bg-amber-50 px-2 text-caption text-amber-ink">
                            {data.pending_requests}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
            {children(data)}
            {!pathname.startsWith(chatPath(childId)) && <AskFab childId={childId} />}
          </div>
        )}
      </QueryView>
    </div>
  );
}

/** "Autism (ASD)", "Autism + ADHD", "Being assessed". */
export function useDiagnosisLabel() {
  const t = useTranslations("companion.diagnosis.kinds");
  return (diagnosis: NonNullable<ChildSummary["diagnosis"]>) => {
    const condition = diagnosis.condition_text;
    if (condition && diagnosis.kind === "autism_plus") return t("autism_plusNamed", { condition });
    if (condition && diagnosis.kind === "other_condition") {
      return t("other_conditionNamed", { condition });
    }
    return t(diagnosis.kind);
  };
}
