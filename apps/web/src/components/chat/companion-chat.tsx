"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  Blocks,
  CalendarCheck,
  FileText,
  HeartHandshake,
  History,
  type LucideIcon,
  MessageCircle,
  Phone,
  RotateCcw,
  School,
  ShieldCheck,
  Sparkles,
  Square,
  SquarePen,
  Stethoscope,
  Target,
  TriangleAlert,
} from "lucide-react";
import Image from "next/image";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { QueryView } from "@/components/app/query-view";
import { ChildPage } from "@/components/companion/child-header";
import { LogEntryCard } from "@/components/logs/log-entry-card";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Sheet } from "@/components/ui/sheet";
import { StateView } from "@/components/ui/state-view";
import { ApiRequestError } from "@/lib/api/client";
import { useErrorMessage } from "@/lib/api/error-message";
import { useMe } from "@/lib/auth/session";
import {
  askCompanionChat,
  type ChatSource,
  type ChatSuggestion,
  type CompanionMessage,
  conversationsKey,
  messagesKey,
  useChatSuggestions,
  useConversationMessages,
  useConversations,
} from "@/lib/chat/companion";
import type { ChildSummary } from "@/lib/children/queries";
import { cx } from "@/lib/cx";
import { Link } from "@/lib/i18n/navigation";
import { useLog } from "@/lib/logs/queries";

import { ChatMarkdown } from "./chat-markdown";

const MAX_LENGTH = 2000;

const SUGGESTION_ICONS: Record<string, LucideIcon> = {
  play_today: Blocks,
  goal_progress: Target,
  week_progress: MessageCircle,
  school_notes: School,
  doctor_questions: Stethoscope,
  class_strategies: School,
  home_practice: Blocks,
  calming: HeartHandshake,
  month_summary: CalendarCheck,
  open_concerns: TriangleAlert,
  status_report: FileText,
};

type Pending = { question: string; reply: string; urgent: boolean };
type Failed = { question: string; error: unknown };

/** `/children/[id]/chat` (design Assistant Chat): the companion chatbot, in the viewer's scope. */
export function CompanionChat({ childId }: { childId: number }) {
  return <ChildPage childId={childId}>{(child) => <ChatScreen child={child} />}</ChildPage>;
}

function ChatScreen({ child }: { child: ChildSummary }) {
  const t = useTranslations("companionChat");
  const me = useMe().data;
  // Which thread is open. `n` changes on every pick or "new", which remounts the thread.
  const [selection, setSelection] = useState<{ id: number | null; n: number }>({
    id: null,
    n: 0,
  });
  const open = (id: number | null) => setSelection((s) => ({ id, n: s.n + 1 }));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sourceId, setSourceId] = useState<number | null>(null);
  const suggestions = useChatSuggestions(child.id);
  if (!me || me.role === "admin") return null;

  const scope = {
    parent: { icon: Sparkles, label: t("scope.parent", { name: child.name }) },
    teacher: { icon: School, label: t("scope.teacher") },
    specialist: { icon: Stethoscope, label: t("scope.specialist") },
  }[me.role];

  return (
    <section
      aria-label={t("title")}
      className="mx-auto flex w-full max-w-(--reading-max) flex-1 flex-col"
    >
      <header className="flex items-center gap-2.5 border-b border-border-1 pb-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] border border-border-1 bg-white">
          <Image src="/brand/mark.png" alt="" width={30} height={30} className="size-7.5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="m-0 font-display text-[17px] leading-[1.3] font-bold text-text-1">
            {t("title")}
          </h2>
          <span
            className={cx(
              "inline-flex items-center gap-1.5 self-start text-[13px] leading-[1.5]",
              me.role === "parent"
                ? "text-text-2"
                : "rounded-pill bg-navy-50 px-2.5 font-semibold text-navy",
              me.role === "specialist" && "bg-leaf-50 text-leaf-ink",
            )}
          >
            <scope.icon aria-hidden className="size-3.25" />
            {scope.label}
          </span>
        </div>
        <IconButton icon={History} label={t("history.open")} onClick={() => setHistoryOpen(true)} />
        <IconButton icon={SquarePen} label={t("newConversation")} onClick={() => open(null)} />
      </header>

      <QueryView query={suggestions}>
        {(data) => (
          <Conversation
            key={selection.n}
            child={child}
            initialId={selection.id}
            aiAvailable={data.ai_available}
            suggestions={data.suggestions}
            onSource={setSourceId}
          />
        )}
      </QueryView>

      <HistorySheet
        childId={child.id}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onPick={(id) => {
          open(id);
          setHistoryOpen(false);
        }}
      />
      <SourceSheet
        childId={child.id}
        myId={me.id}
        logId={sourceId}
        onClose={() => setSourceId(null)}
      />
    </section>
  );
}

function Conversation({
  child,
  initialId,
  aiAvailable,
  suggestions,
  onSource,
}: {
  child: ChildSummary;
  initialId: number | null;
  aiAvailable: boolean;
  suggestions: ChatSuggestion[];
  onSource: (logId: number) => void;
}) {
  const t = useTranslations("companionChat");
  const locale = useLocale() === "en" ? "en" : "bn";
  const queryClient = useQueryClient();
  // A new thread gets its id from the stream's first event; follow-ups continue it.
  const [threadId, setThreadId] = useState<number | null>(initialId);
  const saved = useConversationMessages(threadId);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [failed, setFailed] = useState<Failed | null>(null);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const history = saved.data ?? [];
  const busy = pending !== null;

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [history.length, pending?.reply, failed]);

  async function ask(question: string) {
    const message = question.trim();
    if (!message || busy) return;
    setFailed(null);
    setDraft("");
    setPending({ question: message, reply: "", urgent: false });
    const controller = new AbortController();
    abort.current = controller;
    let id = threadId;
    try {
      await askCompanionChat(
        child.id,
        { conversation_id: threadId, message, locale },
        {
          onMeta: (meta) => {
            id = meta.conversationId;
            setThreadId(id);
            setPending((p) => p && { ...p, urgent: meta.urgent });
          },
          onText: (piece) => setPending((p) => p && { ...p, reply: p.reply + piece }),
        },
        controller.signal,
      );
      // The saved turn replaces the streamed one, so wait for it before dropping `pending`.
      if (id !== null) await queryClient.invalidateQueries({ queryKey: messagesKey(id) });
      void queryClient.invalidateQueries({ queryKey: conversationsKey(child.id) });
    } catch (error) {
      // Stopped or failed: nothing was saved, so the question goes back in the box.
      setDraft(message);
      if (!controller.signal.aborted) setFailed({ question: message, error });
    } finally {
      setPending(null);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(draft);
  }

  const empty = threadId === null && !pending && !failed;

  return (
    <>
      {empty ? (
        <EmptyState
          name={child.name}
          aiAvailable={aiAvailable}
          suggestions={suggestions}
          onAsk={(q) => void ask(q)}
        />
      ) : (
        <div aria-live="polite" className="flex flex-1 flex-col gap-3.5 py-4">
          {saved.isPending && !pending && <StateView kind="loading" />}
          {saved.isError && !pending && <StateView kind="error" title={t("history.loadError")} />}
          {history.map((message) => (
            <Turn key={message.id} message={message} onSource={onSource} />
          ))}
          {pending && (
            <>
              <UserBubble>{pending.question}</UserBubble>
              {pending.urgent && <UrgentCard />}
              {pending.reply ? (
                <AssistantBubble>
                  <ChatMarkdown text={pending.reply} cite={() => null} />
                  <span
                    aria-hidden
                    className="ml-0.5 inline-block h-[1.1em] w-0.5 animate-pulse bg-navy align-[-3px]"
                  />
                </AssistantBubble>
              ) : (
                <Typing label={t("thinking", { name: child.name })} />
              )}
              <button
                type="button"
                onClick={() => abort.current?.abort()}
                className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 self-center rounded-pill border-[1.5px] border-border-2 bg-white px-4 text-[14px] font-semibold text-text-1"
              >
                <Square aria-hidden className="size-3.5" />
                {t("stop")}
              </button>
            </>
          )}
          {failed && <FailedNotice failed={failed} onRetry={() => void ask(failed.question)} />}
          {/* Scrolled into view above the sticky composer. */}
          <div ref={end} className="scroll-mb-44" />
        </div>
      )}

      <form
        onSubmit={submit}
        className="sticky bottom-0 -mx-5 flex flex-col gap-1.5 border-t border-border-1 bg-surface-page px-3 pt-2 pb-4 md:-mx-8 md:px-8"
      >
        <div className="flex items-center gap-1.5">
          <label htmlFor="companion-chat-input" className="sr-only">
            {t("inputLabel")}
          </label>
          <input
            id="companion-chat-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={MAX_LENGTH}
            placeholder={t("placeholder", { name: child.name })}
            autoComplete="off"
            enterKeyHint="send"
            disabled={!aiAvailable}
            className="min-h-12 min-w-0 flex-1 rounded-pill border border-border-1 bg-surface-sunken px-4 text-body text-text-1 placeholder:text-n-400 focus-visible:border-blue disabled:opacity-60"
          />
          <button
            type="submit"
            aria-label={t("send")}
            title={t("send")}
            disabled={busy || !draft.trim() || !aiAvailable}
            className="flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full bg-navy text-white enabled:hover:bg-navy-deep disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowUp aria-hidden className="size-5.5" />
          </button>
        </div>
        <p className="m-0 px-1 text-[13px] leading-[1.45] text-text-2">{t("disclaimer")}</p>
      </form>
    </>
  );
}

function EmptyState({
  name,
  aiAvailable,
  suggestions,
  onAsk,
}: {
  name: string;
  aiAvailable: boolean;
  suggestions: ChatSuggestion[];
  onAsk: (question: string) => void;
}) {
  const t = useTranslations("companionChat");
  const ts = useTranslations("companionChat.suggestions");
  return (
    <div className="flex flex-1 flex-col gap-4.5 py-5">
      <div className="flex flex-col gap-2.5">
        <span className="flex size-16 items-center justify-center rounded-[20px] border border-border-1 bg-white shadow-sm">
          <Image src="/brand/mark.png" alt="" width={48} height={48} className="size-12" />
        </span>
        <h3 className="m-0 font-display text-[24px] leading-[1.45] font-bold text-balance text-text-1">
          {t("empty.title", { name })}
        </h3>
        <p className="m-0 flex items-start gap-2 rounded-[16px] bg-teal-50 px-3.5 py-2.5 text-[14px] leading-[1.6] text-teal-ink">
          <ShieldCheck aria-hidden className="mt-0.5 size-4.5 shrink-0" />
          {t("empty.note", { name })}
        </p>
      </div>
      {aiAvailable ? (
        <div className="flex flex-col gap-2">
          {suggestions.map((suggestion) => {
            const Icon = SUGGESTION_ICONS[suggestion.key] ?? MessageCircle;
            // The API may add a key before this build has its words; skip it until then.
            const key = suggestion.key as Parameters<typeof ts>[0];
            if (!ts.has(key)) return null;
            const question = ts(key, suggestion.params);
            return (
              <button
                key={`${suggestion.key}-${suggestion.params.goal ?? ""}`}
                type="button"
                onClick={() => onAsk(question)}
                className="flex min-h-12 w-full cursor-pointer items-center gap-2.5 rounded-[16px] border-[1.5px] border-border-1 bg-white px-3.5 py-2 text-left text-[15px] leading-[1.5] font-medium text-text-1 hover:bg-navy-50"
              >
                <Icon aria-hidden className="size-4.5 shrink-0 text-teal-ink" />
                {question}
              </button>
            );
          })}
        </div>
      ) : (
        <StateView
          kind="error"
          title={t("errors.notConfiguredTitle")}
          message={t("errors.notConfigured")}
        />
      )}
    </div>
  );
}

function Turn({
  message,
  onSource,
}: {
  message: CompanionMessage;
  onSource: (logId: number) => void;
}) {
  if (message.role === "user") return <UserBubble>{message.content}</UserBubble>;
  const sources = new Map(message.sources.map((s) => [s.log_id, s]));
  return (
    <>
      {message.urgent && <UrgentCard />}
      <AssistantBubble>
        <ChatMarkdown
          text={message.content}
          cite={(id) => {
            const source = sources.get(id);
            return source ? <SourceChip source={source} onOpen={onSource} /> : null;
          }}
        />
      </AssistantBubble>
    </>
  );
}

function UserBubble({ children }: { children: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[min(520px,85%)] rounded-leaf-r bg-navy px-4 py-3 text-body leading-[1.7] whitespace-pre-line text-white">
        {children}
      </div>
    </div>
  );
}

function AssistantBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-end gap-2">
      <Mark />
      <div className="max-w-[min(560px,88%)] min-w-0 rounded-leaf border border-border-1 bg-white px-4 py-3 text-body leading-[1.7] text-text-1 shadow-xs">
        {children}
      </div>
    </div>
  );
}

function Mark() {
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border-1 bg-white"
    >
      <Image src="/brand/mark.png" alt="" width={28} height={28} className="size-7" />
    </span>
  );
}

function Typing({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-end gap-2">
      <Mark />
      <span className="flex items-center gap-3 rounded-leaf border border-border-1 bg-white px-4 py-3 text-small text-text-2">
        <span aria-hidden className="flex gap-1">
          {["", "[animation-delay:.2s]", "[animation-delay:.4s]"].map((delay) => (
            <i
              key={delay}
              className={cx(
                "size-2 rounded-full bg-teal animate-[sj-breathe_1.4s_var(--ease-in-out)_infinite] motion-reduce:animate-none",
                delay,
              )}
            />
          ))}
        </span>
        {label}
      </span>
    </div>
  );
}

/** "Teacher's note · 12 Oct": a cited entry. Opens it in the source sheet. */
function SourceChip({ source, onOpen }: { source: ChatSource; onOpen: (logId: number) => void }) {
  const t = useTranslations("companionChat.source");
  const format = useFormatter();
  // Noon, so the day is the same in every timezone.
  const date = format.dateTime(new Date(`${source.date}T12:00:00`), {
    day: "numeric",
    month: "short",
  });
  return (
    <button
      type="button"
      onClick={() => onOpen(source.log_id)}
      title={source.snippet}
      className="mx-0.5 inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-pill border border-sky-200 bg-sky-50 px-2 align-baseline text-[13px] leading-[1.4] font-semibold whitespace-nowrap text-blue-ink hover:bg-sky-100"
    >
      <FileText aria-hidden className="size-3.25" />
      {t(source.author_role, { date })}
    </button>
  );
}

/** Calm, highlighted card with tap-to-call 999 (design Assistant Chat UrgentCard). */
function UrgentCard() {
  const t = useTranslations("companionChat.urgent");
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-[22px] border-[1.5px] border-amber bg-amber-50 p-4"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-white text-amber-ink">
          <HeartHandshake aria-hidden className="size-6" />
        </span>
        <h3 className="m-0 font-display text-[19px] leading-[1.4] font-bold text-navy">
          {t("title")}
        </h3>
      </div>
      <p className="m-0 text-body leading-[1.7] text-text-1">{t("body")}</p>
      <a
        href="tel:999"
        className="flex min-h-15 items-center gap-3 rounded-[18px] bg-navy px-4 py-2.5 text-[17px] leading-[1.3] font-bold text-white no-underline hover:bg-navy-deep"
      >
        <Phone aria-hidden className="size-5.5" />
        <span className="flex flex-col">
          {t("call")}
          <span className="mt-0.5 text-[13px] font-medium opacity-90">{t("callNote")}</span>
        </span>
      </a>
      <p className="m-0 text-[14px] leading-[1.6] text-text-1">{t("reassure")}</p>
    </div>
  );
}

function FailedNotice({ failed, onRetry }: { failed: Failed; onRetry: () => void }) {
  const t = useTranslations("companionChat");
  const errorMessage = useErrorMessage();
  const code = failed.error instanceof ApiRequestError ? failed.error.body?.error.code : undefined;
  const message =
    code === "ai_not_configured"
      ? t("errors.notConfigured")
      : code === "ai_quota_exceeded"
        ? t("errors.quota")
        : code === "ai_unavailable"
          ? t("errors.unavailable")
          : errorMessage(failed.error);
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-[16px] bg-amber-50 px-4 py-3 text-[15px] leading-[1.6] text-text-1"
    >
      {message}
      {code !== "ai_not_configured" && code !== "ai_quota_exceeded" && (
        <Button size="sm" variant="secondary" icon={RotateCcw} onClick={onRetry}>
          {t("retry")}
        </Button>
      )}
    </div>
  );
}

function SourceSheet({
  childId,
  myId,
  logId,
  onClose,
}: {
  childId: number;
  myId: number;
  logId: number | null;
  onClose: () => void;
}) {
  const t = useTranslations("companionChat.source");
  return (
    <Sheet
      open={logId !== null}
      title={t("sheetTitle")}
      onClose={onClose}
      closeLabel={t("close")}
      footer={
        logId !== null && (
          <Link
            href={`/children/${childId}/timeline#log-${logId}`}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-pill border-[1.5px] border-navy font-semibold text-navy no-underline hover:bg-navy-50"
          >
            {t("viewInTimeline")}
          </Link>
        )
      }
    >
      {logId !== null && <SourceEntry childId={childId} myId={myId} logId={logId} />}
    </Sheet>
  );
}

function SourceEntry({ childId, myId, logId }: { childId: number; myId: number; logId: number }) {
  const entry = useLog(childId, logId);
  return (
    <QueryView query={entry}>
      {(data) => <LogEntryCard childId={childId} entry={data} myId={myId} canExplain={false} />}
    </QueryView>
  );
}

function HistorySheet({
  childId,
  open,
  onClose,
  onPick,
}: {
  childId: number;
  open: boolean;
  onClose: () => void;
  onPick: (conversationId: number) => void;
}) {
  const t = useTranslations("companionChat.history");
  const format = useFormatter();
  const conversations = useConversations(childId, open);
  return (
    <Sheet open={open} title={t("title")} onClose={onClose} closeLabel={t("close")}>
      <QueryView query={conversations}>
        {(list) =>
          list.length === 0 ? (
            <StateView kind="empty" title={t("emptyTitle")} message={t("empty")} />
          ) : (
            <ul className="m-0 flex list-none flex-col p-0">
              {list.map((c) => (
                <li key={c.id} className="border-b border-border-1 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onPick(c.id)}
                    className="flex w-full cursor-pointer items-start gap-3 bg-transparent px-1 py-3 text-left hover:bg-navy-50"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <b className="text-[16px] leading-[1.5] font-semibold text-text-1">
                        {c.title}
                      </b>
                      <span className="line-clamp-1 text-[14px] leading-[1.5] text-text-2">
                        {c.preview}
                      </span>
                    </span>
                    <em className="shrink-0 pt-0.5 text-[13px] text-text-3 not-italic">
                      {format.dateTime(new Date(c.updated_at), { day: "numeric", month: "short" })}
                    </em>
                  </button>
                </li>
              ))}
            </ul>
          )
        }
      </QueryView>
    </Sheet>
  );
}
