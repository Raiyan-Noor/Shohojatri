import { notFound } from "next/navigation";

import { ProfileSectionEdit } from "@/components/companion/profile-section-edit";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata("childProfile");

export default async function ProfileEditPage({
  params,
  searchParams,
}: PageProps<"/[locale]/children/[id]/profile/edit">) {
  const childId = Number((await params).id);
  const { section } = await searchParams;
  if (!Number.isInteger(childId) || childId <= 0 || typeof section !== "string") notFound();
  return <ProfileSectionEdit childId={childId} section={section} />;
}
