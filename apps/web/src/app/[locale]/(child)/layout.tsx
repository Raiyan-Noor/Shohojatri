import type { ReactNode } from "react";

import { AppShell } from "@/components/app/app-shell";
import { RequireRole } from "@/components/auth/gates";

/** Child pages every care-team role opens (scope-filtered by the API): timeline, profile. */
export default function ChildLayout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role={["parent", "teacher", "specialist"]}>
      <AppShell wide>{children}</AppShell>
    </RequireRole>
  );
}
