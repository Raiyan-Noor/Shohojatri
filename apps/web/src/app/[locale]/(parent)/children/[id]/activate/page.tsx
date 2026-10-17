import { notFound } from "next/navigation";

import { ActivationWizard, type WizardStep } from "@/components/companion/activation-wizard";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata("activate");

const STEPS: WizardStep[] = ["diagnosis", "traits", "section", "team", "done"];

export default async function ActivatePage({
  params,
  searchParams,
}: PageProps<"/[locale]/children/[id]/activate">) {
  const childId = Number((await params).id);
  if (!Number.isInteger(childId) || childId <= 0) notFound();
  const { step, section } = await searchParams;
  const current = STEPS.find((s) => s === step) ?? "diagnosis";
  return (
    <ActivationWizard
      childId={childId}
      step={current}
      section={typeof section === "string" ? section : undefined}
    />
  );
}
