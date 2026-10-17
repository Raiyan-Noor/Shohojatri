import { notFound } from "next/navigation";

import { TimelinePage } from "@/components/logs/log-pages";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata("timeline");

export default async function ChildTimelinePage({
  params,
}: PageProps<"/[locale]/children/[id]/timeline">) {
  const childId = Number((await params).id);
  if (!Number.isInteger(childId) || childId <= 0) notFound();
  return <TimelinePage childId={childId} />;
}
