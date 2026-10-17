"use client";

import {
  Blocks,
  Check,
  ChevronRight,
  Ear,
  HeartHandshake,
  HeartPulse,
  MessageCircle,
  Moon,
  Star,
  Target,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import type { Questionnaire } from "@/lib/companion/queries";
import { cx } from "@/lib/cx";

import { useBilingual } from "./section-form";

export const SECTION_ICONS: Record<string, LucideIcon> = {
  communication: MessageCircle,
  social_play: Blocks,
  sensory: Ear,
  triggers: Zap,
  calming: HeartHandshake,
  strengths: Star,
  daily_living: Moon,
  current_support: HeartPulse,
  health: HeartPulse,
  family_goals: Target,
};

/** The 10 sections with done / now / not yet (design W3a). */
export function SectionList({
  questionnaire,
  done,
  current,
  onOpen,
}: {
  questionnaire: Questionnaire;
  done: Record<string, unknown>;
  current?: string;
  onOpen: (section: string) => void;
}) {
  const t = useTranslations("companion.wizard");
  const format = useFormatter();
  const label = useBilingual();
  return (
    <ol className="m-0 flex list-none flex-col rounded-lg border border-border-1 bg-white p-0">
      {questionnaire.sections.map((section, index) => {
        const isDone = section.id in done;
        const isCurrent = section.id === current;
        const Icon = SECTION_ICONS[section.id] ?? Star;
        return (
          <li key={section.id} className="border-b border-border-1 last:border-b-0">
            <button
              type="button"
              onClick={() => onOpen(section.id)}
              className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-2 text-left hover:bg-navy-50"
            >
              <span
                className={cx(
                  "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-small font-bold",
                  isDone
                    ? "bg-leaf text-white"
                    : isCurrent
                      ? "bg-navy text-white"
                      : "bg-n-100 text-text-2",
                )}
              >
                {isDone ? <Check aria-hidden className="size-4" /> : format.number(index + 1)}
              </span>
              <span className={cx("flex-1 text-text-1", isCurrent ? "font-bold" : "font-semibold")}>
                {label({ en: section.title_en, bn: section.title_bn })}
              </span>
              {isDone ? (
                <span className="rounded-pill bg-leaf-50 px-2.5 py-0.5 text-caption font-semibold text-leaf-ink">
                  {t("sectionDone")}
                </span>
              ) : isCurrent ? (
                <span className="rounded-pill bg-navy-50 px-2.5 py-0.5 text-caption font-semibold text-navy">
                  {t("sectionNow")}
                </span>
              ) : (
                <Icon aria-hidden className="size-4.5 text-text-3" />
              )}
              <ChevronRight aria-hidden className="size-5 text-text-3" />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
