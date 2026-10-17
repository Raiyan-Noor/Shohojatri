"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CircleCheck,
  NotebookText,
  Rows3,
  UserPlus,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

import { MY_REQUESTS_KEY } from "@/lib/access/queries";
import { homePathFor, useMe } from "@/lib/auth/session";
import { CHILDREN_KEY } from "@/lib/children/queries";
import { cx } from "@/lib/cx";
import { useRouter } from "@/lib/i18n/navigation";
import { type AppNotification, useMarkRead, useNotifications } from "@/lib/notifications/queries";

const ICONS: Record<AppNotification["kind"], LucideIcon> = {
  access_request_received: UserPlus,
  access_request_approved: CircleCheck,
  access_request_declined: XCircle,
  log_added: NotebookText,
  log_digest: Rows3,
};

/** Header bell with the in-app notification list (request received / approved / declined). */
export function NotificationBell() {
  const t = useTranslations("notifications");
  const notifications = useNotifications();
  const markRead = useMarkRead();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useRefreshOnNewNotification(notifications.data?.items[0]?.id);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const unread = notifications.data?.unread ?? 0;
  const items = notifications.data?.items ?? [];

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={unread > 0 ? t("labelUnread", { count: unread }) : t("label")}
        onClick={() => setOpen(!open)}
        className="relative inline-flex size-12 cursor-pointer items-center justify-center rounded-full text-navy hover:bg-navy-50"
      >
        <Bell aria-hidden className="size-5.5" />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute top-2 right-2 flex min-w-4.5 items-center justify-center rounded-pill bg-amber px-1 text-[11px] leading-4.5 font-bold text-navy-deep"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          id={panelId}
          className="absolute top-full right-0 z-20 mt-1 flex w-[min(360px,calc(100vw-32px))] flex-col rounded-lg border border-border-1 bg-white shadow-lg"
        >
          <div className="flex items-center gap-2 border-b border-border-1 px-4 py-2.5">
            <h2 className="m-0 flex-1 font-display text-[17px] font-bold text-text-1">
              {t("title")}
            </h2>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markRead.mutate("all")}
                className="min-h-10 cursor-pointer rounded-sm px-2 text-small font-semibold text-text-link hover:underline"
              >
                {t("markAll")}
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="m-0 px-4 py-6 text-center text-small text-text-2">{t("empty")}</p>
          ) : (
            <ul className="m-0 max-h-[60dvh] list-none overflow-y-auto p-0">
              {items.map((item) => (
                <NotificationItem key={item.id} item={item} onDone={() => setOpen(false)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationItem({ item, onDone }: { item: AppNotification; onDone: () => void }) {
  const t = useTranslations("notifications.kinds");
  const tRoles = useTranslations("common.roles");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const markRead = useMarkRead();
  const router = useRouter();
  const me = useMe().data;
  const { payload } = item;
  const Icon = ICONS[item.kind];

  const text = t(item.kind, {
    requester: payload.requester_name ?? "",
    role: payload.requester_role ? tRoles(payload.requester_role) : "",
    child: payload.child_name ?? "",
    code: payload.child_code ?? "",
    author: payload.author_name ?? "",
    authorRole: payload.author_role ? tRoles(payload.author_role) : "",
    count: payload.count ?? 0,
  });
  const target = !payload.child_id
    ? me && homePathFor(me)
    : item.kind === "access_request_received"
      ? `/children/${payload.child_id}/care-team`
      : item.kind === "log_added"
        ? `/children/${payload.child_id}/timeline#log-${payload.log_id}`
        : item.kind === "log_digest"
          ? `/children/${payload.child_id}/timeline`
          : me && homePathFor(me);

  return (
    <li className="border-b border-border-1 last:border-b-0">
      <button
        type="button"
        onClick={() => {
          if (!item.read_at) markRead.mutate(item.id);
          onDone();
          if (target) router.push(target);
        }}
        className={cx(
          "flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left hover:bg-navy-50",
          !item.read_at && "bg-sky-50",
        )}
      >
        <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-navy" />
        <span className="min-w-0 flex-1 text-[15px] leading-normal text-text-1">
          {text}
          <span className="block text-caption text-text-3">
            {format.relativeTime(new Date(item.created_at), now)}
          </span>
        </span>
        {!item.read_at && (
          <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-blue" />
        )}
      </button>
    </li>
  );
}

/** A new notification usually means a request or decision happened: refresh what it affects. */
function useRefreshOnNewNotification(latestId: number | undefined) {
  const queryClient = useQueryClient();
  const seen = useRef(latestId);
  useEffect(() => {
    if (latestId === undefined || latestId === seen.current) return;
    if (seen.current !== undefined) {
      void queryClient.invalidateQueries({ queryKey: CHILDREN_KEY });
      void queryClient.invalidateQueries({ queryKey: MY_REQUESTS_KEY });
    }
    seen.current = latestId;
  }, [latestId, queryClient]);
}
