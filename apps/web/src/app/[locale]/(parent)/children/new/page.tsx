import { NewChildForm } from "@/components/children/new-child-form";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata("newChild");

export default async function NewChildPage({ searchParams }: PageProps<"/[locale]/children/new">) {
  // ?companion=1: the child was diagnosed elsewhere; go straight on to the profile wizard.
  const { companion } = await searchParams;
  return <NewChildForm companion={companion === "1"} />;
}
