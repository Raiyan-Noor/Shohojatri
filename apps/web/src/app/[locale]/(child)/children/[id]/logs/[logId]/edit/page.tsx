import { notFound } from "next/navigation";

import { EditLogPage } from "@/components/logs/log-pages";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata("editLog");

export default async function ChildEditLogPage({
  params,
}: PageProps<"/[locale]/children/[id]/logs/[logId]/edit">) {
  const { id, logId } = await params;
  const childId = Number(id);
  const entryId = Number(logId);
  if (!Number.isInteger(childId) || childId <= 0 || !Number.isInteger(entryId) || entryId <= 0) {
    notFound();
  }
  return <EditLogPage childId={childId} logId={entryId} />;
}
