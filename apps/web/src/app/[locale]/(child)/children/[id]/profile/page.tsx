import { notFound } from "next/navigation";

import { ChildProfile } from "@/components/companion/profile";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata("childProfile");

export default async function ChildProfilePage({
  params,
}: PageProps<"/[locale]/children/[id]/profile">) {
  const childId = Number((await params).id);
  if (!Number.isInteger(childId) || childId <= 0) notFound();
  return <ChildProfile childId={childId} />;
}
