"use client";

import { ArrowRight, Check, CircleCheck, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { FormAlert } from "@/components/auth/auth-screen";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ChipOption } from "@/components/ui/chip-option";
import { Sheet } from "@/components/ui/sheet";
import { TextAreaField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/use-toast";
import { useErrorMessage } from "@/lib/api/error-message";
import type { ChildSummary } from "@/lib/children/queries";
import { type LogDomain, useCreateLog } from "@/lib/logs/queries";

import { FaceRating } from "./face-rating";
import { DOMAINS } from "./log-meta";

/** The floating "Log" button and its bottom sheet (COMPANION_SPEC §5.1 "Quick log", design
 *  Q1–Q3): topics → how it went → optional note → save. Three taps without the note. */
export function QuickLog({ childList }: { childList: ChildSummary[] }) {
  const t = useTranslations("logs.quick");
  const [open, setOpen] = useState(false);
  const [toast, showToast] = useToast(4000);
  if (childList.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed right-5 bottom-6 z-10 inline-flex min-h-14 cursor-pointer items-center gap-2 rounded-pill bg-navy px-5.5 font-semibold text-white shadow-lg hover:bg-navy-deep print:hidden"
      >
        <Plus aria-hidden className="size-6" />
        {t("fab")}
      </button>
      {/* Remounted on every open, so each log starts empty. */}
      {open && (
        <QuickLogSheet
          childList={childList}
          onClose={() => setOpen(false)}
          onSaved={(message) => {
            setOpen(false);
            showToast(message);
          }}
        />
      )}
      {toast && (
        <div
          role="status"
          className="fixed right-4 bottom-24 left-4 z-10 mx-auto flex max-w-[480px] items-start gap-3 rounded-lg bg-white px-4 py-3.5 shadow-lg"
        >
          <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-leaf-ink" />
          <span className="text-[15px] text-text-1">{toast}</span>
        </div>
      )}
    </>
  );
}

function QuickLogSheet({
  childList,
  onClose,
  onSaved,
}: {
  childList: ChildSummary[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const t = useTranslations("logs.quick");
  const tLogs = useTranslations("logs");
  const tCommon = useTranslations("common");
  const errorMessage = useErrorMessage();
  const ratingId = useId();
  const [childId, setChildId] = useState(childList[0].id);
  const [step, setStep] = useState<1 | 2>(1);
  const [domains, setDomains] = useState<LogDomain[]>([]);
  const [rating, setRating] = useState<number | null>(null);
  const [text, setText] = useState("");
  const create = useCreateLog(childId);
  const child = childList.find((c) => c.id === childId) ?? childList[0];

  const save = () =>
    create.mutate(
      {
        type: "observation",
        domains,
        ratings: rating ? Object.fromEntries(domains.map((d) => [d, rating])) : {},
        text: text.trim() || null,
      },
      {
        onSuccess: (entry) =>
          onSaved(
            t("saved", {
              topics: entry.domains.map((d) => tLogs(`domains.${d}`)).join(" · "),
              name: child.name,
            }),
          ),
      },
    );

  const footer =
    step === 1 ? (
      <Button
        block
        size="lg"
        iconRight={ArrowRight}
        disabled={domains.length === 0}
        onClick={() => setStep(2)}
      >
        {t("next")}
      </Button>
    ) : (
      <>
        <FormAlert message={create.isError ? errorMessage(create.error) : undefined} />
        <Button block size="lg" icon={Check} loading={create.isPending} onClick={save}>
          {t("save")}
        </Button>
        <span className="text-center text-small text-text-2">{t("whoSees")}</span>
      </>
    );

  return (
    <Sheet open title={t("title")} onClose={onClose} closeLabel={tCommon("close")} footer={footer}>
      <div className="flex flex-col gap-4">
        <span className="text-small font-semibold text-text-2">
          {t("step", { step, total: 2 })}
        </span>
        {step === 1 ? (
          <>
            {childList.length > 1 && (
              <div role="radiogroup" aria-label={t("child")} className="flex flex-wrap gap-2">
                {childList.map((c) => (
                  <ChipOption
                    key={c.id}
                    name="quick-log-child"
                    label={c.name}
                    value={String(c.id)}
                    selected={c.id === childId}
                    onChange={() => setChildId(c.id)}
                  />
                ))}
              </div>
            )}
            <p className="m-0 text-[15px] font-semibold text-text-1">{t("topics")}</p>
            <div className="flex flex-wrap gap-2">
              {DOMAINS.map(({ id, icon }) => (
                <Chip
                  key={id}
                  label={tLogs(`domains.${id}`)}
                  icon={icon}
                  selected={domains.includes(id)}
                  onToggle={() =>
                    setDomains(
                      domains.includes(id) ? domains.filter((d) => d !== id) : [...domains, id],
                    )
                  }
                />
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {domains.map((d) => (
                <span
                  key={d}
                  className="rounded-pill bg-teal-50 px-3 py-1 text-small font-semibold text-teal-ink"
                >
                  {tLogs(`domains.${d}`)}
                </span>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <span id={ratingId} className="text-[15px] font-semibold text-text-1">
                {t("rating")}
              </span>
              <FaceRating labelledBy={ratingId} value={rating} onChange={setRating} />
            </div>
            <TextAreaField
              label={t("text")}
              optionalLabel={tCommon("optional")}
              rows={3}
              maxLength={4000}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <button
              type="button"
              onClick={() => setStep(1)}
              className="min-h-10 cursor-pointer self-start rounded-sm text-small font-semibold text-text-link hover:underline"
            >
              {t("back")}
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
