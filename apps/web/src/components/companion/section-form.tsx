"use client";

import { PencilLine, Plus, Trash2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ChipOption } from "@/components/ui/chip-option";
import { TextField } from "@/components/ui/text-field";
import type {
  Answer,
  ChoiceAnswer,
  Question,
  QuestionnaireSection,
  SectionAnswers,
  TherapyRow,
} from "@/lib/companion/queries";

const OTHER = "other";

type Bilingual = { en: string; bn: string };
export function useBilingual() {
  const locale = useLocale();
  return (label: Bilingual) => (locale === "en" ? label.en : label.bn);
}
export function useQuestionText() {
  const locale = useLocale();
  return (q: { text_en: string; text_bn: string }) => (locale === "en" ? q.text_en : q.text_bn);
}

/** One section of the characteristics questionnaire (COMPANION_SPEC §4, design W3b/W3c): every
 *  question with bilingual answer chips plus "Other (write)". `errorField` is the question the
 *  API rejected. */
export function SectionForm({
  section,
  answers,
  onChange,
  errorField,
  errorMessage,
}: {
  section: QuestionnaireSection;
  answers: SectionAnswers;
  onChange: (answers: SectionAnswers) => void;
  errorField?: string | null;
  errorMessage?: string;
}) {
  const text = useQuestionText();
  return (
    <div className="flex flex-col gap-7">
      {section.questions.map((question) => (
        <QuestionBlock
          key={question.id}
          label={text(question)}
          error={errorField === question.id ? errorMessage : undefined}
        >
          {(labelId) => (
            <QuestionInput
              question={question}
              labelId={labelId}
              value={answers[question.id]}
              onChange={(value) => onChange({ ...answers, [question.id]: value })}
            />
          )}
        </QuestionBlock>
      ))}
    </div>
  );
}

function QuestionBlock({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: (labelId: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2.5">
      <span id={id} className="text-[17px] font-semibold text-text-1">
        {label}
      </span>
      {children(id)}
      {error && (
        <p role="alert" className="m-0 text-small text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function QuestionInput({
  question,
  labelId,
  value,
  onChange,
}: {
  question: Question;
  labelId: string;
  value: Answer | undefined;
  onChange: (value: Answer) => void;
}) {
  switch (question.type) {
    case "single":
    case "multi":
      return (
        <ChoiceInput
          question={question}
          labelId={labelId}
          value={(value as ChoiceAnswer | undefined) ?? { selected: [] }}
          onChange={onChange}
        />
      );
    case "grid":
      return (
        <GridInput
          question={question}
          value={(value as Record<string, string> | undefined) ?? {}}
          onChange={onChange}
        />
      );
    case "text":
      return (
        <TextInput
          labelId={labelId}
          value={(value as string | undefined) ?? ""}
          onChange={onChange}
        />
      );
    case "tags":
      return <TagsInput value={(value as string[] | undefined) ?? []} onChange={onChange} />;
    case "list":
      return (
        <ListInput
          max={question.max ?? 3}
          value={(value as string[] | undefined) ?? []}
          onChange={onChange}
        />
      );
    case "therapies":
      return (
        <TherapiesInput
          question={question}
          value={(value as TherapyRow[] | undefined) ?? []}
          onChange={onChange}
        />
      );
  }
}

function ChoiceInput({
  question,
  labelId,
  value,
  onChange,
}: {
  question: Question;
  labelId: string;
  value: ChoiceAnswer;
  onChange: (value: ChoiceAnswer) => void;
}) {
  const t = useTranslations("companion.traits");
  const label = useBilingual();
  const single = question.type === "single";
  const toggle = (id: string) => {
    const on = value.selected.includes(id);
    const selected = single
      ? on
        ? []
        : [id]
      : on
        ? value.selected.filter((s) => s !== id)
        : [...value.selected, id];
    onChange({ selected, other_text: selected.includes(OTHER) ? (value.other_text ?? "") : null });
  };
  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-2">
        {question.options.map((option) => (
          <Chip
            key={option.id}
            label={label(option)}
            selected={value.selected.includes(option.id)}
            onToggle={() => toggle(option.id)}
          />
        ))}
        {question.other && (
          <Chip
            label={t("other")}
            icon={PencilLine}
            selected={value.selected.includes(OTHER)}
            onToggle={() => toggle(OTHER)}
          />
        )}
      </div>
      {value.selected.includes(OTHER) && (
        <TextField
          label={t("otherLabel")}
          placeholder={t("otherPlaceholder")}
          maxLength={200}
          value={value.other_text ?? ""}
          onChange={(event) => onChange({ ...value, other_text: event.target.value })}
          // The field appears because the parent just chose to write.
          autoFocus
        />
      )}
    </div>
  );
}

function GridInput({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}) {
  const label = useBilingual();
  const name = useId();
  return (
    <div className="flex flex-col divide-y divide-border-1 rounded-lg border border-border-1 bg-white">
      {question.rows.map((row) => (
        <div
          key={row.id}
          role="radiogroup"
          aria-label={label(row)}
          className="flex flex-col gap-2 px-4 py-3"
        >
          <span className="font-semibold text-text-1">{label(row)}</span>
          <div className="flex flex-wrap gap-2">
            {question.options.map((option) => (
              <ChipOption
                key={option.id}
                name={`${name}-${row.id}`}
                label={label(option)}
                value={option.id}
                selected={value[row.id] === option.id}
                onChange={() => onChange({ ...value, [row.id]: option.id })}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TextInput({
  labelId,
  value,
  onChange,
}: {
  labelId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <textarea
      aria-labelledby={labelId}
      rows={3}
      maxLength={1000}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="min-h-24 resize-y rounded-md border-[1.5px] border-border-2 bg-white px-4 py-3 text-body leading-[1.6] text-text-1 outline-none hover:border-n-400 focus:border-blue focus:shadow-[0_0_0_4px_rgba(21,134,188,.16)]"
    />
  );
}

function TagsInput({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const t = useTranslations("companion.traits");
  const [draft, setDraft] = useState("");
  const add = () => {
    const tag = draft.trim();
    if (tag && !value.includes(tag) && value.length < 20) onChange([...value, tag]);
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-3">
      {value.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {value.map((tag) => (
            <li key={tag}>
              <span className="inline-flex min-h-10 items-center gap-1 rounded-pill bg-teal-50 py-1 pr-1 pl-3.5 font-semibold text-teal-ink">
                {tag}
                <button
                  type="button"
                  aria-label={t("removeTag", { tag })}
                  onClick={() => onChange(value.filter((v) => v !== tag))}
                  className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full hover:bg-teal-100"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <TextField
          className="flex-1"
          label={t("addTagLabel")}
          maxLength={60}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button
          type="button"
          variant="secondary"
          icon={Plus}
          onClick={add}
          disabled={!draft.trim()}
        >
          {t("addTag")}
        </Button>
      </div>
    </div>
  );
}

function ListInput({
  max,
  value,
  onChange,
}: {
  max: number;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const t = useTranslations("companion.traits");
  const items = Array.from({ length: max }, (_, i) => value[i] ?? "");
  return (
    <div className="flex flex-col gap-3">
      {items.map((item, index) => (
        <TextField
          key={index}
          label={t("goalN", { n: index + 1 })}
          maxLength={200}
          value={item}
          onChange={(event) => {
            const next = [...items];
            next[index] = event.target.value;
            onChange(next);
          }}
        />
      ))}
    </div>
  );
}

function TherapiesInput({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: TherapyRow[];
  onChange: (value: TherapyRow[]) => void;
}) {
  const t = useTranslations("companion.traits.therapy");
  const label = useBilingual();
  const set = (index: number, row: Partial<TherapyRow>) =>
    onChange(value.map((r, i) => (i === index ? { ...r, ...row } : r)));
  return (
    <div className="flex flex-col gap-3">
      {value.map((row, index) => (
        <div
          key={index}
          className="flex flex-col gap-3 rounded-lg border border-border-1 bg-white p-4"
        >
          <div className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1.5 text-[15px] font-semibold text-text-1">
              {t("type")}
              <select
                value={row.type}
                onChange={(event) =>
                  set(index, {
                    type: event.target.value,
                    other_text: event.target.value === OTHER ? (row.other_text ?? "") : null,
                  })
                }
                className="min-h-13 rounded-md border-[1.5px] border-border-2 bg-white px-4 text-body font-normal text-text-1"
              >
                {question.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {label(option)}
                  </option>
                ))}
                <option value={OTHER}>{t("other")}</option>
              </select>
            </label>
            <Button
              type="button"
              variant="ghost"
              icon={Trash2}
              aria-label={t("remove")}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            />
          </div>
          {row.type === OTHER && (
            <TextField
              label={t("otherLabel")}
              maxLength={200}
              value={row.other_text ?? ""}
              onChange={(event) => set(index, { other_text: event.target.value })}
            />
          )}
          <TextField
            label={t("provider")}
            maxLength={200}
            value={row.provider ?? ""}
            onChange={(event) => set(index, { provider: event.target.value })}
          />
          <TextField
            label={t("frequency")}
            placeholder={t("frequencyPlaceholder")}
            maxLength={200}
            value={row.frequency ?? ""}
            onChange={(event) => set(index, { frequency: event.target.value })}
          />
        </div>
      ))}
      {value.length < 10 && (
        <Button
          type="button"
          variant="secondary"
          icon={Plus}
          className="self-start"
          onClick={() => onChange([...value, { type: question.options[0].id }])}
        >
          {t("add")}
        </Button>
      )}
    </div>
  );
}

/** Answers as plain text for the profile view (and for nobody else: the API stores the ids). */
export function useAnswerText() {
  const label = useBilingual();
  const t = useTranslations("companion.traits");
  return (question: Question, value: Answer): string => {
    const option = (id: string) => {
      const found = question.options.find((o) => o.id === id);
      return found ? label(found) : id;
    };
    switch (question.type) {
      case "single":
      case "multi": {
        const choice = value as ChoiceAnswer;
        return choice.selected
          .map((id) => (id === OTHER ? (choice.other_text ?? t("other")) : option(id)))
          .join(", ");
      }
      case "grid":
        return question.rows
          .filter((row) => (value as Record<string, string>)[row.id])
          .map((row) => `${label(row)}: ${option((value as Record<string, string>)[row.id])}`)
          .join(" · ");
      case "text":
        return value as string;
      case "tags":
      case "list":
        return (value as string[]).join(", ");
      case "therapies":
        return (value as TherapyRow[])
          .map((row) =>
            [row.type === OTHER ? row.other_text : option(row.type), row.provider, row.frequency]
              .filter(Boolean)
              .join(" · "),
          )
          .join("\n");
    }
  };
}
