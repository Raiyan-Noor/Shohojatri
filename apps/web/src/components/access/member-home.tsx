"use client";

import { ArrowRight, BadgeCheck, NotebookPen } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { MyRequests } from "@/components/access/my-requests";
import { RequestAccessBox } from "@/components/access/request-access-box";
import { AskCardLink } from "@/components/chat/ask-links";
import { QueryView } from "@/components/app/query-view";
import { buttonClasses } from "@/components/ui/button";
import { ChildCard } from "@/components/ui/child-card";
import { RoleBadge } from "@/components/ui/role-badge";
import { StateView } from "@/components/ui/state-view";
import { useMe } from "@/lib/auth/session";
import { useChildren, useFormatAge } from "@/lib/children/queries";
import { Link } from "@/lib/i18n/navigation";

/** Teacher and specialist home (COMPANION_SPEC §14): request box, approved children, own
 *  requests. Not designed yet (handoff §1); built from the primitives. */
export function MemberHome({ initialCode }: { initialCode?: string }) {
  const t = useTranslations("homes");
  const tChildren = useTranslations("children");
  const format = useFormatter();
  const formatAge = useFormatAge();
  const children = useChildren();
  // Rendered inside RequireRole, so the user is loaded.
  const me = useMe().data;
  if (!me) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <RoleBadge role={me.role} />
          {me.verified && (
            <span className="inline-flex items-center gap-1 text-small font-semibold text-leaf-ink">
              <BadgeCheck aria-hidden className="size-4.5" />
              {t("verified")}
            </span>
          )}
        </div>
        <div>
          <h1 className="m-0 font-display text-h1 font-bold text-text-1">
            {t("welcome", { name: me.name })}
          </h1>
          {me.organisation && <p className="mt-1 mb-0 text-body text-text-2">{me.organisation}</p>}
        </div>
      </div>

      <RequestAccessBox initialCode={initialCode} />

      <section aria-labelledby="children-title" className="flex flex-col gap-3">
        <h2 id="children-title" className="m-0 font-display text-h2 font-bold text-text-1">
          {t("member.childrenTitle")}
        </h2>
        <QueryView
          query={children}
          empty={
            <StateView
              kind="empty"
              title={t("member.emptyTitle")}
              message={t("member.emptyMessage")}
            />
          }
        >
          {(list) => (
            <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
              {list.map((child) => (
                <li key={child.id}>
                  <ChildCard
                    name={child.name}
                    meta={formatAge(child.age_months)}
                    badge={
                      <span className="rounded-pill bg-teal-50 px-2.5 py-0.5 text-caption font-semibold text-teal-ink">
                        {tChildren(`scope.${child.access}`)}
                      </span>
                    }
                  >
                    {child.member_since && (
                      <p className="m-0 text-small text-text-3">
                        {tChildren("memberSince", {
                          date: format.dateTime(new Date(child.member_since), {
                            dateStyle: "medium",
                          }),
                        })}
                      </p>
                    )}
                    <div className="mt-auto flex flex-col gap-2">
                      <Link
                        href={`/children/${child.id}/timeline`}
                        className="flex min-h-12 items-center gap-3 rounded-md bg-n-50 px-4 py-2 font-semibold text-navy no-underline hover:bg-navy-50"
                      >
                        <span className="flex-1">
                          {tChildren("timeline")}
                          {child.new_logs > 0 && (
                            <span className="ml-2 inline-block rounded-pill bg-amber-50 px-2.5 py-0.5 text-small font-semibold text-amber-ink">
                              {tChildren("newLogs", { count: child.new_logs })}
                            </span>
                          )}
                        </span>
                        <ArrowRight aria-hidden className="size-5" />
                      </Link>
                      <AskCardLink childId={child.id} />
                      {/* "Add classroom note" / "Add clinical note" is the card's main action (§14). */}
                      <Link
                        href={`/children/${child.id}/logs/new`}
                        className={buttonClasses({ size: "md", block: true })}
                      >
                        <NotebookPen aria-hidden className="size-5" />
                        {me.role === "specialist"
                          ? t("member.addClinical")
                          : t("member.addClassroom")}
                      </Link>
                    </div>
                  </ChildCard>
                </li>
              ))}
            </ul>
          )}
        </QueryView>
      </section>

      <MyRequests />
    </div>
  );
}
