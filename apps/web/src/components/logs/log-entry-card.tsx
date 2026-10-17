"use client";

import { ArrowDown, ArrowUp, Lock, Pencil, PencilLine, Target } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Avatar } from "@/components/ui/avatar";
import { RoleBadge } from "@/components/ui/role-badge";
import { cx } from "@/lib/cx";
import { Link } from "@/lib/i18n/navigation";
import type { LogEntry } from "@/lib/logs/queries";

import { ExplainPanel } from "./explain-panel";
import { DOMAINS, FACES, TYPE_ICONS } from "./log-meta";

type Props = {
  childId: number;
  entry: LogEntry;
  myId: number;
  /** The parent may ask for any teacher's or specialist's entry to be explained. */
  canExplain: boolean;
};

/** One timeline entry (design handoff `LogEntryCard`): author badge, type, text, topics, the
 *  day's rating, goal progress, who can see it, and edit / correct / explain. */
export function LogEntryCard({ childId, entry, myId, canExplain }: Props) {
  const t = useTranslations("logs");
  const format = useFormatter();
  const TypeIcon = TYPE_ICONS[entry.type];
  const mine = entry.author.id === myId;
  // Quick logs rate every chosen topic the same, so one face is enough.
  const ratings = [...new Set(Object.values(entry.ratings))];
  const Face = ratings.length === 1 ? FACES[ratings[0] - 1] : null;
  const anchor = (id: number) => `#log-${id}`;

  return (
    <article
      id={`log-${entry.id}`}
      className={cx(
        "flex scroll-mt-24 flex-col gap-3 rounded-lg border bg-white px-5 py-4 shadow-sm",
        entry.corrected_by_log_id ? "border-border-1 opacity-75" : "border-[rgba(0,60,120,.06)]",
      )}
    >
      <header className="flex items-start gap-3">
        <Avatar name={entry.author.name} size={40} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-text-1">
              {mine ? t("card.you", { name: entry.author.name }) : entry.author.name}
            </span>
            <RoleBadge role={entry.author.role} />
          </div>
          <span className="text-caption text-text-3">
            {format.dateTime(new Date(entry.occurred_at), { timeStyle: "short" })}
            {entry.edited_at && ` · ${t("card.edited")}`}
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-pill bg-n-50 px-2.5 py-1 text-caption font-semibold text-text-2">
          <TypeIcon aria-hidden className="size-3.75" />
          {t(`types.${entry.type}`)}
        </span>
      </header>

      {entry.corrects_log_id && (
        <a
          href={anchor(entry.corrects_log_id)}
          className="inline-flex items-center gap-1.5 self-start text-small font-semibold text-text-link"
        >
          <ArrowDown aria-hidden className="size-4" />
          {t("card.correction")}
        </a>
      )}

      {entry.explains_log_id && (
        <a
          href={anchor(entry.explains_log_id)}
          className="inline-flex items-center gap-1.5 self-start text-small font-semibold text-text-link"
        >
          <ArrowDown aria-hidden className="size-4" />
          {t("card.explains")}
        </a>
      )}

      {entry.text && (
        <p className="m-0 text-body leading-relaxed whitespace-pre-line text-text-1">
          {entry.text}
        </p>
      )}

      {(entry.domains.length > 0 || Face) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {entry.domains.map((domain) => {
            const Icon = DOMAINS.find((d) => d.id === domain)?.icon;
            return (
              <span
                key={domain}
                className="inline-flex items-center gap-1 rounded-pill bg-teal-50 px-2.5 py-0.5 text-caption font-semibold text-teal-ink"
              >
                {Icon && <Icon aria-hidden className="size-3.5" />}
                {t(`domains.${domain}`)}
              </span>
            );
          })}
          {Face && (
            <span className="inline-flex items-center gap-1 rounded-pill bg-amber-50 px-2.5 py-0.5 text-caption font-semibold text-amber-ink">
              <Face.icon aria-hidden className="size-3.5" />
              {t(`faces.${String(Face.value) as "1"}`)}
            </span>
          )}
        </div>
      )}

      {entry.goal && entry.goal_progress && (
        <p className="m-0 flex items-center gap-1.5 text-small text-text-2">
          <Target aria-hidden className="size-4 shrink-0 text-leaf-ink" />
          <span>
            {entry.goal.title} ·{" "}
            <b className="font-semibold">{t(`progress.${entry.goal_progress}`)}</b>
          </span>
        </p>
      )}

      {entry.visibility !== "care_team" && (
        <p className="m-0 flex items-center gap-1.5 text-caption text-text-3">
          <Lock aria-hidden className="size-3.5" />
          {t(
            `visibility.${entry.visibility}.${entry.author.role === "parent" ? "hint" : "hintMember"}`,
          )}
        </p>
      )}

      {entry.corrected_by_log_id && (
        <a
          href={anchor(entry.corrected_by_log_id)}
          className="inline-flex items-center gap-1.5 self-start text-small font-semibold text-text-link"
        >
          <ArrowUp aria-hidden className="size-4" />
          {t("card.corrected")}
        </a>
      )}

      {(entry.can_edit || entry.can_correct) && (
        <div className="flex flex-wrap gap-2">
          {entry.can_edit && (
            <Link
              href={`/children/${childId}/logs/${entry.id}/edit`}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-pill px-3 text-small font-semibold text-navy hover:bg-navy-50"
            >
              <Pencil aria-hidden className="size-4" />
              {t("card.edit")}
            </Link>
          )}
          {entry.can_correct && (
            <Link
              href={`/children/${childId}/logs/new?corrects=${entry.id}`}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-pill px-3 text-small font-semibold text-navy hover:bg-navy-50"
            >
              <PencilLine aria-hidden className="size-4" />
              {t("card.correct")}
            </Link>
          )}
        </div>
      )}

      {canExplain && entry.author.role !== "parent" && entry.text && (
        <ExplainPanel childId={childId} entry={entry} />
      )}
    </article>
  );
}
