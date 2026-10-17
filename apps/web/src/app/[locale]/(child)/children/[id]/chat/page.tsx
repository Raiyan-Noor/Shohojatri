import { notFound } from "next/navigation";

import { CompanionChat } from "@/components/chat/companion-chat";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata("companionChat");

export default async function ChildChatPage({ params }: PageProps<"/[locale]/children/[id]/chat">) {
  const childId = Number((await params).id);
  if (!Number.isInteger(childId) || childId <= 0) notFound();
  return <CompanionChat childId={childId} />;
}
