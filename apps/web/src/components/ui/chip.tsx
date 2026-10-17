import { Check, type LucideIcon } from "lucide-react";

import { cx } from "@/lib/cx";

type ChipProps = {
  label: string;
  selected: boolean;
  onToggle: () => void;
  /** Shown while not selected; a check replaces it once selected. */
  icon?: LucideIcon;
  disabled?: boolean;
};

/** A selectable pill (design handoff `Chip`, multi-select). A toggle button, so screen readers
 *  announce "pressed". For one-of-many use `ChipOption` (a radio) instead. */
export function Chip({ label, selected, onToggle, icon: Icon, disabled }: ChipProps) {
  const Shown = selected ? Check : Icon;
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className={cx(
        "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-pill border-[1.5px] px-4 font-semibold",
        "transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-45",
        selected
          ? "border-navy bg-navy-50 text-navy"
          : "border-border-2 bg-white text-text-2 hover:border-n-400",
      )}
    >
      {Shown && <Shown aria-hidden className="size-4.5 shrink-0" />}
      {label}
    </button>
  );
}
