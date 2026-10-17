import { notFound } from "next/navigation";

import { NewLogPage } from "@/components/logs/log-pages";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata("newLog");

export default async function ChildNewLogPage({
  params,
  searchParams,
}: PageProps<"/[locale]/children/[id]/logs/new">) {
  const childId = Number((await params).id);
  if (!Number.isInteger(childId) || childId <= 0) notFound();
  const corrects = Number((await searchParams).corrects);
  return (
    <NewLogPage
      childId={childId}
      corrects={Number.isInteger(corrects) && corrects > 0 ? corrects : undefined}
    />
  );
}
