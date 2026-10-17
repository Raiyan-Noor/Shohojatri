import { useTranslations } from "next-intl";

import { cx } from "@/lib/cx";

import { FACES } from "./log-meta";

/** "How was it today?" 1 (very hard) … 5 (great), or the child's mood (design handoff
 *  `FaceRating`). Picking the chosen face again clears it, since both are optional. */
export function FaceRating({
  value,
  onChange,
  labelledBy,
  scale = "day",
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  labelledBy: string;
  scale?: "day" | "mood";
}) {
  const t = useTranslations(scale === "mood" ? "logs.moods" : "logs.faces");
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid grid-cols-5 gap-1.5">
      {FACES.map(({ value: face, icon: Icon }) => {
        const on = value === face;
        return (
          <button
            key={face}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(on ? null : face)}
            className={cx(
              "flex min-h-18 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-[1.5px] px-1 py-2",
              "text-caption font-semibold leading-tight transition-colors duration-200",
              on
                ? "border-navy bg-navy-50 text-navy"
                : "border-border-1 bg-white text-text-2 hover:border-n-400",
            )}
          >
            <Icon aria-hidden className="size-7" strokeWidth={on ? 2.25 : 1.75} />
            <span className="text-center">{t(String(face) as "1")}</span>
          </button>
        );
      })}
    </div>
  );
}
