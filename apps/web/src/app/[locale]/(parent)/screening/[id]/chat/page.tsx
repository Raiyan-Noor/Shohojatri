import { ResultsChat } from "@/components/results/results-chat";
import { pageMetadata } from "@/lib/i18n/metadata";
import { screeningIdFrom } from "@/lib/screening/screening-id";

export const generateMetadata = pageMetadata("resultsChat");

export default async function ResultsChatPage({
  params,
}: PageProps<"/[locale]/screening/[id]/chat">) {
  return <ResultsChat screeningId={await screeningIdFrom(params)} />;
}
