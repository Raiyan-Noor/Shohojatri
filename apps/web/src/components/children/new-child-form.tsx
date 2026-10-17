"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Calendar, Plus, Smile } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { FormAlert } from "@/components/auth/auth-screen";
import { Button } from "@/components/ui/button";
import { ChipOption } from "@/components/ui/chip-option";
import { TextField } from "@/components/ui/text-field";
import { useErrorMessage } from "@/lib/api/error-message";
import { showApiError } from "@/lib/api/form-errors";
import { useCreateChild } from "@/lib/children/queries";
import { todayInBangladesh } from "@/lib/dates";
import { Link, useRouter } from "@/lib/i18n/navigation";

const SEXES = ["female", "male", "unsaid"] as const;

/** A parent adds a child. Screening (B4) and the profile wizard (B9) build on this record; with
 *  `companion` the wizard follows straight away (COMPANION_SPEC §1, "create directly"). */
export function NewChildForm({ companion = false }: { companion?: boolean }) {
  const t = useTranslations("children.new");
  const tv = useTranslations("auth.validation");
  const tCommon = useTranslations("common");
  const errorMessage = useErrorMessage();
  const createChild = useCreateChild();
  const router = useRouter();
  // The latest date of birth the API accepts.
  const today = todayInBangladesh();

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, tv("required")),
        dob: z.string().min(1, tv("required")),
        sex: z.enum(SEXES),
      }),
    [tv],
  );
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { name: "", dob: "", sex: "unsaid" as const },
  });
  const { errors, isSubmitting } = form.formState;
  const sex = useWatch({ control: form.control, name: "sex" });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const child = await createChild.mutateAsync({
        name: values.name,
        dob: values.dob,
        sex: values.sex === "unsaid" ? null : values.sex,
      });
      router.push(companion ? `/children/${child.id}/activate` : "/home");
    } catch (error) {
      showApiError(error, form.setError, errorMessage(error));
    }
  });

  return (
    <div className="mx-auto flex w-full max-w-(--reading-max) flex-col gap-6">
      <Link
        href="/home"
        className="inline-flex min-h-12 items-center gap-2 self-start font-semibold text-text-link hover:underline"
      >
        <ArrowLeft aria-hidden className="size-5" />
        {t("back")}
      </Link>
      <div>
        <h1 className="m-0 font-display text-h1 font-bold text-text-1">{t("title")}</h1>
        <p className="mt-1 mb-0 text-body text-text-2">
          {companion ? t("subtitleCompanion") : t("subtitle")}
        </p>
      </div>

      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        <TextField
          label={t("name")}
          icon={Smile}
          hint={t("nameHint")}
          placeholder={t("namePlaceholder")}
          autoComplete="off"
          error={errors.name?.message}
          {...form.register("name")}
        />
        <TextField
          label={t("dob")}
          type="date"
          icon={Calendar}
          max={today}
          error={errors.dob?.message}
          {...form.register("dob")}
        />
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[15px] font-semibold text-text-1">
            {t("sex")}{" "}
            <span className="text-small font-normal text-text-3">{tCommon("optional")}</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {SEXES.map((option) => (
              <ChipOption
                key={option}
                label={t(option)}
                value={option}
                selected={sex === option}
                {...form.register("sex")}
              />
            ))}
          </div>
        </fieldset>
        <FormAlert message={errors.root?.message} />
        <Button type="submit" size="lg" icon={Plus} loading={isSubmitting} className="self-start">
          {companion ? t("submitCompanion") : t("submit")}
        </Button>
      </form>
    </div>
  );
}
