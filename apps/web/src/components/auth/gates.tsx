"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { StateView } from "@/components/ui/state-view";
import { useErrorMessage } from "@/lib/api/error-message";
import { homePathFor, type Me, type Role, useMe } from "@/lib/auth/session";
import { usePathname, useRouter } from "@/lib/i18n/navigation";

// Client-side guards decide what to *show*; the API enforces who may *do* what.

type RedirectFor = (me: Me | null, pathname: string) => string | null;

function Gate({ redirectFor, children }: { redirectFor: RedirectFor; children: ReactNode }) {
  const t = useTranslations("common");
  const errorMessage = useErrorMessage();
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const target = me.isSuccess ? redirectFor(me.data, pathname) : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  let content: ReactNode = children;
  if (me.isError) {
    content = (
      <StateView
        kind="error"
        message={errorMessage(me.error)}
        action={
          <Button variant="secondary" loading={me.isFetching} onClick={() => void me.refetch()}>
            {t("retry")}
          </Button>
        }
      />
    );
  } else if (!me.isSuccess || target) {
    content = <StateView kind="loading" title={t("loading")} />;
  } else {
    return children;
  }
  return <div className="flex min-h-dvh flex-col items-center justify-center">{content}</div>;
}

/** Only for `role` (or any of several). Others go to their own home; logged-out users to login
 *  and back. */
export function RequireRole({ role, children }: { role: Role | Role[]; children: ReactNode }) {
  const roles = Array.isArray(role) ? role : [role];
  return (
    <Gate
      redirectFor={(me, pathname) => {
        if (!me) return `/login?next=${encodeURIComponent(pathname)}`;
        if (me.must_change_password || !roles.includes(me.role)) return homePathFor(me);
        return null;
      }}
    >
      {children}
    </Gate>
  );
}

/** Login / sign-up: a logged-in user goes straight to their home. */
export function GuestOnly({ children }: { children: ReactNode }) {
  return <Gate redirectFor={(me) => (me ? homePathFor(me) : null)}>{children}</Gate>;
}

/** The set-new-password screen: only while a temporary password is still in use. */
export function PendingPasswordOnly({ children }: { children: ReactNode }) {
  return (
    <Gate redirectFor={(me) => (!me ? "/login" : me.must_change_password ? null : homePathFor(me))}>
      {children}
    </Gate>
  );
}

/** Any logged-in user; `redirectFor` may send them on by role. Logged-out users log in first and
 *  come back to `returnTo` (default: this path, without its query string). */
export function RequireUser({
  redirectFor,
  returnTo,
  children,
}: {
  redirectFor?: (me: Me) => string | null;
  returnTo?: string;
  children: ReactNode;
}) {
  return (
    <Gate
      redirectFor={(me, pathname) => {
        if (!me) return `/login?next=${encodeURIComponent(returnTo ?? pathname)}`;
        if (me.must_change_password) return homePathFor(me);
        return redirectFor?.(me) ?? null;
      }}
    >
      {children}
    </Gate>
  );
}
