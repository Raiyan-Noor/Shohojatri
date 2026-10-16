import { ArrowRight } from "lucide-react";
import Image from "next/image";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AltLink } from "@/components/auth/auth-screen";
import { ReturningUserRedirect } from "@/components/landing/returning-user-redirect";
import { buttonClasses } from "@/components/ui/button";
import { LanguageToggle } from "@/components/ui/language-toggle";
import { Link } from "@/lib/i18n/navigation";
import { routing } from "@/lib/i18n/routing";

const LOGOS = {
  bn: { src: "/brand/logo_shoho.png", width: 755, height: 815 },
  en: { src: "/brand/logo_shoho_en.png", width: 1039, height: 834 },
} as const;

// App entry, the design's in-app splash (Onboarding 01). No marketing landing is designed.
export default async function LandingPage({ params }: PageProps<"/[locale]">) {
  const { locale: requested } = await params;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  setRequestLocale(locale);
  const t = await getTranslations("landing");
  const tCommon = await getTranslations("common");
  const logo = LOGOS[locale];

  return (
    <div className="flex min-h-dvh flex-col bg-(image:--sj-gradient-sky)">
      <ReturningUserRedirect />
      <header className="flex justify-end px-4 pt-3">
        <LanguageToggle />
      </header>
      <main className="mx-auto flex w-full max-w-(--reading-max) flex-1 flex-col items-center justify-center gap-6 px-8 text-center">
        <h1 className="m-0">
          <Image
            src={logo.src}
            alt={tCommon("appName")}
            width={logo.width}
            height={logo.height}
            priority
            className="h-auto w-[230px]"
          />
        </h1>
      </main>
      <div className="mx-auto flex w-full max-w-(--reading-max) flex-col gap-2 px-5 pt-3 pb-7">
        <Link href="/signup" className={buttonClasses({ size: "lg", block: true })}>
          {t("start")}
          <ArrowRight aria-hidden className="size-5" />
        </Link>
        <AltLink question={t("haveAccount")} label={t("login")} href="/login" />
      </div>
    </div>
  );
}
