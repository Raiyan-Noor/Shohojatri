"use client";

import { Check, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { FormAlert } from "@/components/auth/auth-screen";
import { Button } from "@/components/ui/button";
import { ApiRequestError } from "@/lib/api/client";
import { useErrorMessage } from "@/lib/api/error-message";
import {
  type LogEntry,
  type LogExplanation,
  useCreateLog,
  useExplainLog,
} from "@/lib/logs/queries";

/** "Explain this to me" under a teacher's or specialist's entry, for the parent (COMPANION_SPEC
 *  §5.1, design B2 `Explain`). The explanation is not saved unless the parent keeps it. */
export function ExplainPanel({ childId, entry }: { childId: number; entry: LogEntry }) {
  const t = useTranslations("logs.explain");
  const locale = useLocale() === "en" ? "en" : "bn";
  const errorMessage = useErrorMessage();
  const explain = useExplainLog();
  const save = useCreateLog(childId);
  const [open, setOpen] = useState(false);
  const result = explain.data;
  // The shared AI errors talk about the results chat; these two get wording for this panel.
  const code = explain.error instanceof ApiRequestError ? explain.error.code : null;
  const ownError = code === "ai_not_configured" || code === "ai_unavailable" ? code : null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          if (!result) explain.mutate({ id: entry.id, locale });
        }}
        className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 self-start rounded-pill bg-sky-50 px-3.5 text-small font-semibold text-navy hover:bg-navy-50"
      >
        <Sparkles aria-hidden className="size-4" />
        {t("button")}
      </button>
    );
  }

  return (
    <div
      aria-live="polite"
      className="flex flex-col gap-2.5 rounded-md border border-navy-100 bg-sky-50 px-4 py-3.5"
    >
      <p className="m-0 flex items-center gap-1.5 text-small font-bold text-navy">
        <Sparkles aria-hidden className="size-4" />
        {t("title")}
      </p>
      {explain.isPending && <p className="m-0 text-small text-text-2">{t("thinking")}</p>}
      {explain.isError && (
        <div className="flex flex-col gap-2">
          <FormAlert message={ownError ? t(`errors.${ownError}`) : errorMessage(explain.error)} />
          {ownError !== "ai_not_configured" && (
            <Button
              size="sm"
              variant="secondary"
              className="self-start"
              onClick={() => explain.mutate({ id: entry.id, locale })}
            >
              {t("retry")}
            </Button>
          )}
        </div>
      )}
      {result && (
        <>
          <p className="m-0 text-[15px] leading-relaxed text-text-1">{result.summary}</p>
          <p className="m-0 text-[15px] leading-relaxed text-text-1">
            <b className="font-semibold">{t("atHome")} </b>
            {result.at_home}
          </p>
          {result.ask_next.length > 0 && (
            <div>
              <p className="m-0 text-[15px] font-semibold text-text-1">{t("askNext")}</p>
              <ul className="m-0 mt-1 flex flex-col gap-1 pl-5 text-[15px] text-text-1">
                {result.ask_next.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="m-0 text-caption text-text-3">{t("disclaimer")}</p>
          {save.isError && <FormAlert message={errorMessage(save.error)} />}
          <div className="flex flex-wrap items-center gap-2">
            {save.isSuccess ? (
              <span className="inline-flex min-h-10 items-center gap-1.5 text-small font-semibold text-leaf-ink">
                <Check aria-hidden className="size-4" />
                {t("saved")}
              </span>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                loading={save.isPending}
                onClick={() =>
                  save.mutate({
                    type: "observation",
                    text: noteText(result, t("atHome"), t("askNext")),
                    explains_log_id: entry.id,
                    visibility: "private",
                  })
                }
              >
                {t("save")}
              </Button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-10 cursor-pointer rounded-sm px-2 text-small font-semibold text-text-link hover:underline"
            >
              {t("hide")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function noteText(result: LogExplanation, atHome: string, askNext: string): string {
  const parts = [result.summary, `${atHome} ${result.at_home}`];
  if (result.ask_next.length > 0) {
    parts.push([askNext, ...result.ask_next.map((q) => `• ${q}`)].join("\n"));
  }
  return parts.join("\n\n");
}
