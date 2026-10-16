"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Info, RotateCcw, Send, Sparkles } from "lucide-react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { QueryView } from "@/components/app/query-view";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { StateView } from "@/components/ui/state-view";
import { useErrorMessage } from "@/lib/api/error-message";
import { cx } from "@/lib/cx";
import { Link } from "@/lib/i18n/navigation";
import {
  askResultsChat,
  type ChatMessage,
  resultsChatKey,
  useResultsChat,
} from "@/lib/screening/chat";
import { useScreeningReport } from "@/lib/screening/queries";
import { type Report, resultPath } from "@/lib/screening/results";

import { useResultText } from "./use-result-text";

// SCREENING_SPEC §8, in this order.
const SUGGESTIONS = ["meaning", "next", "doctor", "play"] as const;
const MAX_LENGTH = 1000;

type Pending = { question: string; reply: string };

/** `/screening/[id]/chat` (design Results C1): questions about one finalized result. */
export function ResultsChat({ screeningId }: { screeningId: number }) {
  const report = useScreeningReport(screeningId, "parent");
  return (
    <QueryView query={report}>
      {(data) => <ChatScreen screeningId={screeningId} report={data} />}
    </QueryView>
  );
}

function ChatScreen({ screeningId, report }: { screeningId: number; report: Report }) {
  const t = useTranslations("resultsChat");
  const text = useResultText(report);
  const chat = useResultsChat(screeningId);

  return (
    <div className="mx-auto flex w-full max-w-(--reading-max) flex-1 flex-col">
      <header className="flex items-center gap-2.5 border-b border-border-1 pb-3">
        <Link
          href={resultPath(screeningId)}
          aria-label={t("back")}
          title={t("back")}
          className="-ml-3 flex size-12 shrink-0 items-center justify-center rounded-full text-navy hover:bg-navy-50"
        >
          <ArrowLeft aria-hidden className="size-5.5" />
        </Link>
        <Image
          src="/brand/mark.png"
          alt=""
          width={36}
          height={36}
          className="size-9 object-contain"
        />
        <div className="min-w-0 flex-1">
          <h1 className="m-0 font-display text-[19px] leading-[1.3] font-bold text-text-1">
            {t("title")}
          </h1>
          <p className="m-0 text-small text-text-2">
            {t("subtitle", { name: text.name, date: text.date })}
          </p>
        </div>
      </header>

      <p className="mt-3 mb-0 flex items-start gap-2 rounded-[16px] bg-sky-50 px-3.5 py-2.5 text-[14px] leading-[1.6] font-medium text-blue-ink">
        <Info aria-hidden className="mt-0.5 size-4.5 shrink-0" />
        {t("banner")}
      </p>

      <QueryView query={chat}>
        {(data) =>
          data.ai_available ? (
            <Conversation screeningId={screeningId} name={text.name} history={data.messages} />
          ) : (
            <StateView
              kind="error"
              title={t("unavailable.title")}
              message={t("unavailable.message")}
              action={
                <Link href={resultPath(screeningId)} className="font-semibold text-blue-ink">
                  {t("back")}
                </Link>
              }
            />
          )
        }
      </QueryView>
    </div>
  );
}

function Conversation({
  screeningId,
  name,
  history,
}: {
  screeningId: number;
  name: string;
  history: ChatMessage[];
}) {
  const t = useTranslations("resultsChat");
  const locale = useLocale() === "en" ? "en" : "bn";
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [failed, setFailed] = useState<{ question: string; error: unknown } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const busy = pending !== null;

  // Leaving the page stops the reply; nothing is saved for an unfinished answer.
  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [history.length, pending?.reply, failed]);

  async function ask(question: string) {
    const message = question.trim();
    if (!message || busy) return;
    setFailed(null);
    setDraft("");
    setPending({ question: message, reply: "" });
    const controller = new AbortController();
    abort.current = controller;
    try {
      await askResultsChat(
        screeningId,
        { message, locale },
        (piece) => setPending((p) => p && { ...p, reply: p.reply + piece }),
        controller.signal,
      );
      // The saved turn replaces the streamed one, so wait for it before dropping `pending`.
      await queryClient.invalidateQueries({ queryKey: resultsChatKey(screeningId) });
    } catch (error) {
      if (controller.signal.aborted) return;
      setFailed({ question: message, error });
      setDraft(message);
    } finally {
      if (!controller.signal.aborted) setPending(null);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(draft);
  }

  return (
    <>
      <div aria-live="polite" className="flex flex-1 flex-col gap-3 py-4">
        {history.length === 0 && !pending && (
          <Bubble from="assistant">{t("intro", { name })}</Bubble>
        )}
        {history.map((message) => (
          <Bubble key={message.id} from={message.role}>
            {message.content}
          </Bubble>
        ))}
        {pending && (
          <>
            <Bubble from="user">{pending.question}</Bubble>
            {pending.reply ? (
              <Bubble from="assistant">{pending.reply}</Bubble>
            ) : (
              <Thinking label={t("thinking")} />
            )}
          </>
        )}
        {failed && (
          <div
            role="alert"
            className="flex flex-col items-start gap-2 rounded-[16px] bg-amber-50 px-4 py-3 text-[15px] leading-[1.6] text-text-1"
          >
            {errorMessage(failed.error)}
            <Button
              size="sm"
              variant="secondary"
              icon={RotateCcw}
              onClick={() => void ask(failed.question)}
            >
              {t("retry")}
            </Button>
          </div>
        )}
        {/* Scrolled into view above the sticky composer. */}
        <div ref={end} className="scroll-mb-56" />
      </div>

      <div className="sticky bottom-0 -mx-5 flex flex-col gap-2 border-t border-border-1 bg-surface-page px-5 pt-3 pb-4 md:-mx-8 md:px-8">
        <p className="m-0 text-caption font-semibold text-text-2">
          {history.length ? t("suggestMore") : t("suggest")}
        </p>
        <div className="-mx-5 flex snap-x gap-2 overflow-x-auto px-5 pb-1 md:mx-0 md:flex-wrap md:px-0">
          {SUGGESTIONS.map((key) => (
            <button
              key={key}
              type="button"
              disabled={busy}
              onClick={() => void ask(t(`suggestions.${key}`))}
              className={cx(
                "min-h-11 shrink-0 cursor-pointer snap-start rounded-pill border-[1.5px] border-border-2 bg-white px-4 font-semibold text-text-2",
                "enabled:hover:border-navy enabled:hover:text-navy disabled:cursor-not-allowed disabled:opacity-45",
              )}
            >
              {t(`suggestions.${key}`)}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="flex items-center gap-1.5">
          <label htmlFor="results-chat-input" className="sr-only">
            {t("inputLabel")}
          </label>
          <input
            id="results-chat-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={MAX_LENGTH}
            placeholder={t("placeholder")}
            autoComplete="off"
            enterKeyHint="send"
            className="min-h-12 min-w-0 flex-1 rounded-pill border border-border-1 bg-surface-sunken px-4 text-body text-text-1 placeholder:text-n-400 focus-visible:border-blue"
          />
          <IconButton
            type="submit"
            icon={Send}
            label={t("send")}
            variant="soft"
            disabled={busy || !draft.trim()}
          />
        </form>
      </div>
    </>
  );
}

function Bubble({ from, children }: { from: ChatMessage["role"]; children: string }) {
  const me = from === "user";
  return (
    <div className={cx("flex items-end gap-2.5", me && "flex-row-reverse")}>
      {!me && <Avatar />}
      <div
        className={cx(
          "max-w-[min(520px,85%)] px-4 py-3 text-body leading-[1.7] whitespace-pre-line",
          me
            ? "rounded-leaf-r bg-navy text-white"
            : "rounded-leaf border border-border-1 bg-white text-text-1 shadow-xs",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function Thinking({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-end gap-2.5">
      <Avatar />
      <span className="flex items-center gap-2 rounded-leaf border border-border-1 bg-white px-4 py-3 text-small text-text-2">
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

function Avatar() {
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border-1 bg-teal-50 text-teal-ink"
    >
      <Sparkles className="size-4.5" />
    </span>
  );
}
