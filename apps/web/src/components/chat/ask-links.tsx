"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/lib/i18n/navigation";

export const chatPath = (childId: number) => `/children/${childId}/chat`;

/** The floating "Ask" button (design Assistant Chat E1/E2). Sits above the quick-log button,
 *  which keeps the bottom-right corner. */
export function AskFab({ childId }: { childId: number }) {
  const t = useTranslations("companionChat");
  return (
    <Link
      href={chatPath(childId)}
      className="fixed right-5 bottom-24 z-10 inline-flex min-h-14 items-center gap-2 rounded-pill border-[1.5px] border-navy-100 bg-white px-5.5 font-semibold text-navy no-underline shadow-lg hover:bg-navy-50 print:hidden"
    >
      <Sparkles aria-hidden className="size-5 text-teal-ink" />
      {t("ask")}
    </Link>
  );
}

/** "Ask Shohojatri AI" row on a child card. */
export function AskCardLink({ childId }: { childId: number }) {
  const t = useTranslations("companionChat");
  return (
    <Link
      href={chatPath(childId)}
      className="flex min-h-12 items-center gap-3 rounded-md bg-teal-50 px-4 py-2 font-semibold text-teal-ink no-underline hover:bg-teal-100"
    >
      <Sparkles aria-hidden className="size-5" />
      <span className="flex-1">{t("askLong")}</span>
      <ArrowRight aria-hidden className="size-5" />
    </Link>
  );
}
