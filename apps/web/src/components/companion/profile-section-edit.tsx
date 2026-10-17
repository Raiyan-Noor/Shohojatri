"use client";

import { QueryView } from "@/components/app/query-view";
import { useChild } from "@/lib/children/queries";
import { useRouter } from "@/lib/i18n/navigation";

import { SectionStep } from "./activation-wizard";

/** Edits one characteristics section from the profile; saving makes a new version (§4). */
export function ProfileSectionEdit({ childId, section }: { childId: number; section: string }) {
  const child = useChild(childId);
  const router = useRouter();
  const back = () => router.push(`/children/${childId}/profile`);
  return (
    <div className="mx-auto flex w-full max-w-(--reading-max) flex-col gap-6">
      <QueryView query={child}>
        {(data) => (
          <SectionStep child={data} sectionId={section} editing onNext={back} onBack={back} />
        )}
      </QueryView>
    </div>
  );
}
