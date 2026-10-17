"use client";

import { History, UserPlus, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { QueryView } from "@/components/app/query-view";
import { ActivityFeed } from "@/components/care-team/activity-feed";
import { CareTeamList } from "@/components/care-team/care-team-list";
import { ChildIdPanel } from "@/components/care-team/child-id-panel";
import { ChildPage } from "@/components/companion/child-header";
import { JoinRequest } from "@/components/care-team/join-request";
import { useMe } from "@/lib/auth/session";
import { useActivity, useGrants, useIncomingRequests } from "@/lib/care-team/queries";

/** The parent's Care team tab (COMPANION_SPEC §3, §14 tab 6; design Companion B6). */
export function CareTeamPage({ childId }: { childId: number }) {
  const t = useTranslations("careTeam");
  const requests = useIncomingRequests(childId);
  const grants = useGrants(childId);
  const activity = useActivity(childId);
  // Rendered inside RequireRole, so the user is loaded.
  const me = useMe().data;
  if (!me) return null;

  return (
    <ChildPage childId={childId}>
      {({ name, code }) => (
        <div className="flex flex-col gap-6">
          <div>
            <h2 className="m-0 font-display text-h2 font-bold text-text-1">
              {t("title", { name })}
            </h2>
            <p className="mt-1 mb-0 max-w-[60ch] text-body text-text-2">
              {t("subtitle", { name })}
            </p>
          </div>
          <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex flex-col gap-6">
              {code && <ChildIdPanel childId={childId} name={name} code={code} />}
              {requests.data && requests.data.length > 0 && (
                <Section icon={UserPlus} title={t("pendingTitle")}>
                  {requests.data.map((request) => (
                    <JoinRequest key={request.id} request={request} />
                  ))}
                </Section>
              )}
              <Section icon={Users} title={t("membersTitle")}>
                <QueryView query={grants}>
                  {(list) => <CareTeamList parentName={me.name} childName={name} grants={list} />}
                </QueryView>
              </Section>
            </div>
            <aside className="flex flex-col gap-3 rounded-lg border border-[rgba(0,60,120,.06)] bg-white px-5 py-4.5 shadow-sm">
              <h2 className="m-0 flex items-center gap-2 font-display text-[17px] font-bold text-text-1">
                <History aria-hidden className="size-4.5 text-navy" />
                {t("activityTitle")}
              </h2>
              <QueryView query={activity}>
                {(entries) => <ActivityFeed entries={entries} myId={me.id} childName={name} />}
              </QueryView>
            </aside>
          </div>
        </div>
      )}
    </ChildPage>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Users;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="m-0 flex items-center gap-2 font-display text-[19px] font-bold text-text-1">
        <Icon aria-hidden className="size-5 text-navy" />
        {title}
      </h2>
      {children}
    </section>
  );
}
