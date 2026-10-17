"use client";

import { Ear, Eye } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Card } from "@/components/ui/card";
import { vibrate } from "@/lib/activities/sound";
import { sleep, waitForSample } from "@/lib/activities/timeline";
import { AwayGate, lookingAway } from "@/lib/cv/realtime";
import { cx } from "@/lib/cx";
import type { Screening } from "@/lib/screening/rules";

import { CamFeed } from "./cam-feed";
import { useCapture } from "./capture-provider";
import { ParentControls, Stage, StageToast, TrialDots } from "./stage";
import { type RunContext, TaskFrame } from "./task-frame";
import { useToast } from "@/components/ui/use-toast";

// SCREENING_SPEC §4.4.
const TRIALS = 3;
/** "Something went wrong" adds a try, up to this many in all. */
const MAX_TRIALS = 5;
const MIN_GAP_MS = 15000; // between calls
const GATE_TIMEOUT_MS = 20000; // never looked away: call anyway, trial excluded
// After the prompt: voice onset within 4 s, then a 5-s response window.
const CALL_SHOWN_MS = 2500;
const RESPONSE_MS = 9000;

type Phase = "waiting" | "call" | "watching";

/** Response to name (design Screening Flow 08a–b). The parent holds the phone and calls when
 *  the screen says so, once the child has looked away for 1.5 s. */
export function NameCallTask({ screening }: { screening: Screening }) {
  const t = useTranslations("activities.nameCall");
  const { deviceType, session } = useCapture();
  const [phase, setPhase] = useState<Phase>("waiting");
  const [trial, setTrial] = useState({ current: 1, total: TRIALS });
  const [toast, showToast] = useToast();
  // Counts "Call now" prompts that couldn't vibrate; each one flashes the screen once.
  const [flashes, setFlashes] = useState(0);
  const total = useRef(TRIALS);
  const current = useRef(1);
  const recorderRef = useRef<RunContext["recorder"] | null>(null);
  const name = screening.child_name;
  const phone = deviceType === "phone";

  async function run({ session, recorder, signal }: RunContext) {
    recorderRef.current = recorder;
    total.current = TRIALS;
    const gate = new AwayGate();
    let lastPrompt: number | null = null;
    for (let n = 1; n <= total.current; n++) {
      current.current = n;
      setTrial({ current: n, total: total.current });
      setPhase("waiting");
      if (lastPrompt !== null) {
        await sleep(Math.max(0, lastPrompt + MIN_GAP_MS - performance.now()), signal);
      }
      gate.reset();
      const away = await waitForSample(
        session,
        (s) => gate.update(s.at, lookingAway(!!s.features.face, s.features.yaw)),
        GATE_TIMEOUT_MS,
        signal,
      );
      setPhase("call");
      if (!vibrate(250)) setFlashes((n) => n + 1);
      recorder.mark({ type: "prompt", trial: n, pre_state: away ? "away" : "facing" });
      lastPrompt = performance.now();
      await sleep(CALL_SHOWN_MS, signal);
      setPhase("watching");
      await sleep(RESPONSE_MS - CALL_SHOWN_MS, signal);
    }
  }

  function somethingWrong() {
    recorderRef.current?.mark({ type: "something_wrong", trial: current.current });
    if (total.current < MAX_TRIALS) total.current += 1;
    setTrial({ current: current.current, total: total.current });
    showToast(t("wrongNoted"));
  }

  return (
    <TaskFrame
      screening={screening}
      slug="name-call"
      camera={phone ? "rear" : "front"}
      title={t("title")}
      subtitle={t("subtitle", { name })}
      intro={
        <Card tone="sky" className="flex flex-col gap-2.5">
          <p className="m-0">{t(phone ? "setupPhone" : "setupLaptop", { name })}</p>
          <p className="m-0">{t("setupToy", { name })}</p>
          <p className="m-0 font-semibold">{t("setupCall", { name })}</p>
        </Card>
      }
      run={run}
      stage={({ stop, skip }) => (
        <Stage
          tone="dark"
          onStop={stop}
          top={
            <TrialDots
              dark
              current={trial.current}
              total={trial.total}
              label={t("tryCount", { n: trial.current, total: trial.total })}
            />
          }
          background={session && <CamFeed session={session} className="absolute inset-0" />}
          controls={<ParentControls dark onSkip={skip} onWrong={somethingWrong} />}
        >
          {flashes > 0 && (
            // A single fade, never a repeating strobe. Keyed so every prompt flashes again.
            <div
              key={flashes}
              aria-hidden
              className="pointer-events-none fixed inset-0 bg-amber opacity-0 animate-[sj-flash_700ms_ease-out]"
            />
          )}
          {toast && <StageToast>{toast}</StageToast>}
          <div className="flex flex-1 items-end px-4" aria-live="assertive">
            <div
              className={cx(
                "flex w-full flex-col items-start gap-2.5 rounded-xl px-5.5 py-6",
                phase === "call" ? "bg-amber text-navy-deep" : "bg-n-900/80 text-white",
              )}
            >
              {phase === "call" ? (
                <>
                  <Ear aria-hidden className="size-9" />
                  <p className="m-0 font-display text-[40px] leading-[1.3] font-extrabold text-balance">
                    {t("callNow", { name })}
                  </p>
                  <p className="m-0 text-[18px] font-medium">{t("callHow", { name })}</p>
                </>
              ) : phase === "watching" ? (
                <>
                  <Eye aria-hidden className="size-8" />
                  <p className="m-0 font-display text-[30px] leading-[1.4] font-bold">
                    {t("watching")}
                  </p>
                  <p className="m-0 text-[18px] font-medium">{t("watchingHow")}</p>
                </>
              ) : (
                <>
                  <span aria-hidden className="flex gap-2">
                    {[
                      "bg-blue",
                      "bg-teal [animation-delay:.2s]",
                      "bg-sprout [animation-delay:.4s]",
                    ].map((c) => (
                      <i
                        key={c}
                        className={cx(
                          "size-3 rounded-full animate-[sj-breathe_1.4s_var(--ease-in-out)_infinite]",
                          c,
                        )}
                      />
                    ))}
                  </span>
                  <p className="m-0 font-display text-[30px] leading-[1.4] font-bold">
                    {t("waiting", { name })}
                  </p>
                  <p className="m-0 text-[18px] font-medium">{t("waitingHow")}</p>
                </>
              )}
            </div>
          </div>
        </Stage>
      )}
    />
  );
}
