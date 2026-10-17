"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Fragment, useState } from "react";

import { ChildPage } from "@/components/companion/child-header";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { StateView } from "@/components/ui/state-view";
import { Tabs } from "@/components/ui/tabs";
import { useErrorMessage } from "@/lib/api/error-message";
import { useMe } from "@/lib/auth/session";
import { todayInBangladesh } from "@/lib/dates";
import {
  type AuthorRole,
  type LogEntry,
  type LogFilters,
  type LogType,
  useLogs,
} from "@/lib/logs/queries";

import { LogEntryCard } from "./log-entry-card";
import { DOMAINS, TYPE_ICONS } from "./log-meta";

const AUTHORS = ["all", "parent", "teacher", "specialist"] as const;
const ALL_TYPES = Object.keys(TYPE_ICONS) as LogType[];

/** The Timeline tab (COMPANION_SPEC §14 tab 2, design B2): every entry the viewer may see,
 *  filtered by author role, topic and type, grouped by day. */
export function Timeline({ childId }: { childId: number }) {
  return <ChildPage childId={childId}>{() => <TimelineBody childId={childId} />}</ChildPage>;
}

function TimelineBody({ childId }: { childId: number }) {
  const t = useTranslations("logs");
  const tCommon = useTranslations("common");
  const errorMessage = useErrorMessage();
  const me = useMe().data;
  const [filters, setFilters] = useState<LogFilters>({});
  const logs = useLogs(childId, filters);
  if (!me) return null;

  const entries = logs.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = Boolean(filters.authorRole || filters.domain || filters.type);

  let content;
  if (logs.isPending) {
    content = <StateView kind="loading" title={tCommon("loading")} />;
  } else if (logs.isError) {
    content = (
      <StateView
        kind="error"
        message={errorMessage(logs.error)}
        action={
          <Button variant="secondary" onClick={() => void logs.refetch()}>
            {tCommon("retry")}
          </Button>
        }
      />
    );
  } else if (entries.length === 0) {
    content = (
      <StateView
        kind="empty"
        title={filtered ? t("empty.filteredTitle") : t("empty.title")}
        message={filtered ? t("empty.filteredMessage") : t("empty.message")}
      />
    );
  } else {
    content = (
      <div className="flex flex-col gap-3">
        <DayGroups entries={entries}>
          {(entry) => (
            <LogEntryCard
              key={entry.id}
              childId={childId}
              entry={entry}
              myId={me.id}
              canExplain={me.role === "parent"}
            />
          )}
        </DayGroups>
        {logs.hasNextPage && (
          <Button
            variant="secondary"
            className="self-center"
            loading={logs.isFetchingNextPage}
            onClick={() => void logs.fetchNextPage()}
          >
            {t("more")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex max-w-(--reading-max) flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="overflow-x-auto">
          <Tabs
            idPrefix="timeline-author"
            label={t("filters.author")}
            value={filters.authorRole ?? "all"}
            onChange={(id) =>
              setFilters({ ...filters, authorRole: id === "all" ? undefined : (id as AuthorRole) })
            }
            items={AUTHORS.map((id) => ({ id, label: t(`filters.authors.${id}`) }))}
          />
        </div>
        <div role="group" aria-label={t("filters.domain")} className="flex flex-wrap gap-2">
          {DOMAINS.map(({ id, icon }) => (
            <Chip
              key={id}
              label={t(`domains.${id}`)}
              icon={icon}
              selected={filters.domain === id}
              onToggle={() =>
                setFilters({ ...filters, domain: filters.domain === id ? undefined : id })
              }
            />
          ))}
        </div>
        <label className="flex flex-wrap items-center gap-2 text-small font-semibold text-text-2">
          {t("filters.type")}
          <select
            value={filters.type ?? ""}
            onChange={(event) =>
              setFilters({ ...filters, type: (event.target.value || undefined) as LogType })
            }
            className="min-h-11 rounded-md border-[1.5px] border-border-2 bg-white px-3 text-[15px] font-normal text-text-1"
          >
            <option value="">{t("filters.allTypes")}</option>
            {ALL_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`types.${type}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {/* The panels of the author tabs: one list, refiltered. */}
      <div role="tabpanel" id={`timeline-author-panel-${filters.authorRole ?? "all"}`}>
        {content}
      </div>
    </div>
  );
}

function DayGroups({
  entries,
  children,
}: {
  entries: LogEntry[];
  children: (entry: LogEntry) => React.ReactNode;
}) {
  const t = useTranslations("logs");
  const format = useFormatter();
  const today = todayInBangladesh();
  const days = entries.map((entry) =>
    new Date(entry.occurred_at).toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" }),
  );
  return entries.map((entry, index) => {
    const day = days[index];
    const heading =
      index > 0 && day === days[index - 1]
        ? null
        : day === today
          ? t("today")
          : format.dateTime(new Date(entry.occurred_at), { dateStyle: "long" });
    return (
      <Fragment key={entry.id}>
        {heading && (
          <h2 className="m-0 mt-3 text-small font-bold tracking-wide text-text-2 first:mt-0">
            {heading}
          </h2>
        )}
        {children(entry)}
      </Fragment>
    );
  });
}
