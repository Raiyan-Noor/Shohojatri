"use client";

import { ArrowRight, ClipboardCheck, NotebookText, Plus, UserPlus, Users } from "lucide-react";
import { useTranslations } from "next-intl";

import { QueryView } from "@/components/app/query-view";
import { AskCardLink, AskFab } from "@/components/chat/ask-links";
import { ChildCode } from "@/components/children/child-code";
import { QuickLog } from "@/components/logs/quick-log";
import { InstallAppCard } from "@/components/pwa/install-app-card";
import { ChildScreeningLink, ScreenHero } from "@/components/screening/screening-home";
import { buttonClasses } from "@/components/ui/button";
import { ChildCard } from "@/components/ui/child-card";
import { StateView } from "@/components/ui/state-view";
import { useMe } from "@/lib/auth/session";
import { useChildren, useFormatAge } from "@/lib/children/queries";
import { Link } from "@/lib/i18n/navigation";

/** Parent home: start a screening, and their children, each with Child ID, screening progress
 *  and a way into the care team. */
export function ParentHome() {
  const t = useTranslations("homes");
  const tChildren = useTranslations("children");
  const formatAge = useFormatAge();
  const children = useChildren();
  // Rendered inside RequireRole, so the user is loaded.
  const me = useMe().data;
  if (!me) return null;
  // The "Ask" button opens the chat about the first child in the companion stage.
  const firstCompanion = children.data?.find((child) => child.status === "companion");

  const addChild = (
    <Link href="/children/new" className={buttonClasses({ variant: "secondary", size: "sm" })}>
      <Plus aria-hidden className="size-5" />
      {t("parent.addChild")}
    </Link>
  );

  return (
    <div className="mx-auto flex w-full max-w-(--reading-max) flex-col gap-6">
      <h1 className="m-0 font-display text-h1 font-bold text-text-1">
        {t("welcome", { name: me.name })}
      </h1>

      <ScreenHero />

      <InstallAppCard />

      <section aria-labelledby="children-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="children-title" className="m-0 font-display text-h2 font-bold text-text-1">
            {t("parent.childrenTitle")}
          </h2>
          {children.data && children.data.length > 0 && addChild}
        </div>
        <QueryView
          query={children}
          empty={
            <StateView
              kind="empty"
              title={t("parent.emptyTitle")}
              message={t("parent.emptyMessage")}
              action={
                <Link href="/children/new" className={buttonClasses()}>
                  <Plus aria-hidden className="size-5" />
                  {t("parent.addChild")}
                </Link>
              }
            />
          }
        >
          {(list) => (
            <ul className="m-0 grid list-none gap-4 p-0">
              {list.map((child) => (
                <li key={child.id}>
                  <ChildCard
                    name={child.name}
                    meta={`${formatAge(child.age_months)} · ${tChildren(`status.${child.status}`)}`}
                    badge={child.code && <ChildCode code={child.code} />}
                  >
                    <div className="flex flex-col gap-2">
                      {child.status === "companion" ? (
                        <CardLink href={`/children/${child.id}/timeline`} icon={NotebookText}>
                          {tChildren("timeline")}
                          {child.characteristics_done < child.characteristics_total && (
                            <span className="ml-2 inline-block rounded-pill bg-amber-50 px-2.5 py-0.5 text-small font-semibold text-amber-ink">
                              {tChildren("traitsProgress", {
                                done: child.characteristics_done,
                                total: child.characteristics_total,
                              })}
                            </span>
                          )}
                        </CardLink>
                      ) : (
                        <CardLink href={`/children/${child.id}/activate`} icon={ClipboardCheck}>
                          {tChildren("activate")}
                        </CardLink>
                      )}
                      {child.status === "companion" && <AskCardLink childId={child.id} />}
                      <ChildScreeningLink childId={child.id} />
                      <Link
                        href={`/children/${child.id}/care-team`}
                        className="flex min-h-12 items-center gap-3 rounded-md bg-n-50 px-4 py-2 font-semibold text-navy no-underline hover:bg-navy-50"
                      >
                        {child.pending_requests > 0 ? (
                          <UserPlus aria-hidden className="size-5 text-amber-ink" />
                        ) : (
                          <Users aria-hidden className="size-5" />
                        )}
                        <span className="flex-1">
                          {tChildren("careTeam")}
                          {child.pending_requests > 0 && (
                            <span className="ml-2 inline-block rounded-pill bg-amber-50 px-2.5 py-0.5 text-small font-semibold text-amber-ink">
                              {tChildren("pendingRequests", { count: child.pending_requests })}
                            </span>
                          )}
                        </span>
                        <ArrowRight aria-hidden className="size-5" />
                      </Link>
                    </div>
                  </ChildCard>
                </li>
              ))}
            </ul>
          )}
        </QueryView>
        <Link
          href="/children/new?companion=1"
          className="self-start font-semibold text-text-link hover:underline"
        >
          {t("parent.alreadyDiagnosed")}
        </Link>
      </section>
      {children.data && (
        <QuickLog childList={children.data.filter((child) => child.status === "companion")} />
      )}
      {firstCompanion && <AskFab childId={firstCompanion.id} />}
    </div>
  );
}

function CardLink({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: typeof Users;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-12 items-center gap-3 rounded-md bg-n-50 px-4 py-2 font-semibold text-navy no-underline hover:bg-navy-50"
    >
      <Icon aria-hidden className="size-5" />
      <span className="flex-1">{children}</span>
      <ArrowRight aria-hidden className="size-5" />
    </Link>
  );
}
