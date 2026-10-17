"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { QueryView } from "@/components/app/query-view";
import { StateView } from "@/components/ui/state-view";
import { useMe } from "@/lib/auth/session";
import { useChild } from "@/lib/children/queries";
import { Link } from "@/lib/i18n/navigation";
import { useLog } from "@/lib/logs/queries";

import { LogForm } from "./log-form";
import { QuickLog } from "./quick-log";
import { Timeline } from "./timeline";

function Frame({
  childId,
  title,
  children,
}: {
  childId: number;
  title: string;
  children: ReactNode;
}) {
  const t = useTranslations("logs.form");
  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/children/${childId}/timeline`}
        className="inline-flex min-h-12 items-center gap-2 self-start font-semibold text-text-link hover:underline"
      >
        <ArrowLeft aria-hidden className="size-5" />
        {t("back")}
      </Link>
      <h1 className="m-0 font-display text-h1 font-bold text-text-1">{title}</h1>
      {children}
    </div>
  );
}

/** A new entry, or (with `corrects`) a correction of one whose edit window has closed. */
export function NewLogPage({ childId, corrects }: { childId: number; corrects?: number }) {
  const t = useTranslations("logs.form");
  const child = useChild(childId);
  const role = useMe().data?.role;
  const name = child.data?.name ?? "";
  if (corrects) {
    return (
      <Frame childId={childId} title={t("correctTitle")}>
        <OneLog childId={childId} logId={corrects}>
          {(original) => <LogForm childId={childId} mode={{ kind: "correct", original }} />}
        </OneLog>
      </Frame>
    );
  }
  const title =
    role === "teacher"
      ? t("titleTeacher", { name })
      : role === "specialist"
        ? t("titleSpecialist", { name })
        : t("title", { name });
  return (
    <Frame childId={childId} title={title}>
      <LogForm childId={childId} mode={{ kind: "new" }} />
    </Frame>
  );
}

export function EditLogPage({ childId, logId }: { childId: number; logId: number }) {
  const t = useTranslations("logs.form");
  return (
    <Frame childId={childId} title={t("editTitle")}>
      <OneLog childId={childId} logId={logId}>
        {(entry) =>
          entry.can_edit ? (
            <LogForm childId={childId} mode={{ kind: "edit", entry }} />
          ) : (
            <StateView kind="empty" title={t("windowClosed")} message={t("windowClosedHint")} />
          )
        }
      </OneLog>
    </Frame>
  );
}

function OneLog({
  childId,
  logId,
  children,
}: {
  childId: number;
  logId: number;
  children: (entry: NonNullable<ReturnType<typeof useLog>["data"]>) => ReactNode;
}) {
  const log = useLog(childId, logId);
  return <QueryView query={log}>{children}</QueryView>;
}

/** The Timeline tab with the quick-log button. */
export function TimelinePage({ childId }: { childId: number }) {
  const child = useChild(childId);
  return (
    <>
      <Timeline childId={childId} />
      {child.data && <QuickLog childList={[child.data]} />}
    </>
  );
}
