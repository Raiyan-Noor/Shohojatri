"use client";

import { Hand, MonitorSmartphone, Pointer } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Card } from "@/components/ui/card";
import { ChoiceCard } from "@/components/ui/choice-card";
import { reward, say } from "@/lib/activities/sound";
import { balancedSides, sleep, untilSignal } from "@/lib/activities/timeline";
import type { TaskRecorder } from "@/lib/cv/capture";
import { cx } from "@/lib/cx";
import type { Screening } from "@/lib/screening/rules";

import { CamFeed } from "./cam-feed";
import { useCapture } from "./capture-provider";
import { Ball, Boat, Character } from "./character";
import { ParentControls, Stage, StageToast, TrialDots } from "./stage";
import { type RunContext, TaskFrame } from "./task-frame";
import { useToast } from "@/components/ui/use-toast";

type Side = "left" | "right";
type Variant = "on_screen" | "live";

// SCREENING_SPEC §4.5 (T2a): engage 0-1.5 s, cue at 1.5 s, window to 3.5 s, reward to 5 s.
const ON_SCREEN_TRIALS = 6;
const ENGAGE_MS = 1500;
const WINDOW_MS = 2000;
const REWARD_MS = 1500;
const REST_MS = 1000;
const LEAD_IN_MS = 1000;
// T2b: 4 trials, 2 per side; voice onset within 4 s of the tap, then a 3-s window.
const LIVE_TRIALS = 4;
const LIVE_WATCH_MS = 7000;
/** "Something went wrong" repeats a trial on the same side (keeps the balance), this often. */
const MAX_EXTRA = 2;

const LOOK = { bn: "দেখো!", en: "Look!" };

type Scene = { trial: number; side: Side; phase: "ready" | "engage" | "cue" | "reward" | "rest" };
type LiveStep = { trial: number; side: Side; phase: "place" | "watch" };

/** Look where I point (design Screening Flow 09a–b): a character points at a toy on screen, or
 *  the parent points at a real toy (live). */
export function PointTask({ screening }: { screening: Screening }) {
  const t = useTranslations("activities.point");
  const locale = useLocale();
  const { deviceType, session } = useCapture();
  const [variant, setVariant] = useState<Variant>("on_screen");
  const [scene, setScene] = useState<Scene>({ trial: 1, side: "left", phase: "ready" });
  const [live, setLive] = useState<LiveStep>({ trial: 1, side: "left", phase: "place" });
  const [count, setCount] = useState(ON_SCREEN_TRIALS);
  const [toast, showToast] = useToast();
  const sides = useRef<Side[]>([]);
  const extra = useRef(0);
  const trialRef = useRef(1);
  const recorderRef = useRef<TaskRecorder | null>(null);
  const tap = useRef<((side: Side) => void) | null>(null);
  const name = screening.child_name;
  const phone = deviceType === "phone";

  async function runOnScreen({ recorder, signal }: RunContext) {
    sides.current = balancedSides(ON_SCREEN_TRIALS);
    setScene({ trial: 1, side: sides.current[0], phase: "ready" });
    await sleep(LEAD_IN_MS, signal);
    for (let i = 0; i < sides.current.length; i++) {
      const trial = i + 1;
      const side = sides.current[i];
      trialRef.current = trial;
      setScene({ trial, side, phase: "engage" });
      recorder.mark({ type: "engage", trial, side });
      say(LOOK, locale);
      await sleep(ENGAGE_MS, signal);
      setScene({ trial, side, phase: "cue" });
      recorder.mark({ type: "cue", trial, side });
      await sleep(WINDOW_MS, signal);
      setScene({ trial, side, phase: "reward" });
      reward();
      await sleep(REWARD_MS, signal);
      setScene({ trial, side, phase: "rest" });
      await sleep(REST_MS, signal);
    }
    recorder.mark({ type: "end" });
  }

  async function runLive({ session, recorder, signal }: RunContext) {
    sides.current = balancedSides(LIVE_TRIALS);
    for (let i = 0; i < sides.current.length; i++) {
      const trial = i + 1;
      trialRef.current = trial;
      setLive({ trial, side: sides.current[i], phase: "place" });
      const tapped = await untilSignal(
        new Promise<Side>((resolve) => (tap.current = resolve)),
        signal,
      );
      // The side in the camera image: a mirrored (front camera) preview swaps screen sides.
      const side = session.mirrored ? (tapped === "left" ? "right" : "left") : tapped;
      recorder.mark({ type: "cue", trial, side });
      setLive({ trial, side: tapped, phase: "watch" });
      await sleep(LIVE_WATCH_MS, signal);
    }
    recorder.mark({ type: "end" });
  }

  async function run(context: RunContext) {
    recorderRef.current = context.recorder;
    extra.current = 0;
    setCount(variant === "live" ? LIVE_TRIALS : ON_SCREEN_TRIALS);
    if (variant === "live") await runLive(context);
    else await runOnScreen(context);
    return { variant };
  }

  function somethingWrong() {
    const trial = trialRef.current;
    recorderRef.current?.mark({ type: "something_wrong", trial });
    if (extra.current < MAX_EXTRA) {
      extra.current += 1;
      sides.current.push(sides.current[trial - 1]);
      setCount(sides.current.length);
    }
    showToast(t("wrongNoted"));
  }

  const current = variant === "live" ? live.trial : scene.trial;
  const trialDots = (dark?: boolean) => (
    <TrialDots
      dark={dark}
      current={current}
      total={count}
      label={t("tryCount", { n: current, total: count })}
    />
  );

  return (
    <TaskFrame
      screening={screening}
      slug="point"
      camera={variant === "live" && phone ? "rear" : "front"}
      title={t("title")}
      subtitle={t("subtitle", { name })}
      intro={
        <>
          <div role="radiogroup" aria-label={t("variantQuestion")} className="flex flex-col gap-3">
            <ChoiceCard
              name="point-variant"
              value="on_screen"
              icon={MonitorSmartphone}
              label={t("onScreen")}
              description={t("onScreenHow", { name })}
              selected={variant === "on_screen"}
              onSelect={() => setVariant("on_screen")}
            />
            <ChoiceCard
              name="point-variant"
              value="live"
              icon={Hand}
              label={t("live")}
              description={t("liveHow", { name })}
              selected={variant === "live"}
              onSelect={() => setVariant("live")}
            />
          </div>
          <Card tone="sky" className="flex flex-col gap-2">
            {variant === "on_screen" ? (
              <>
                <p className="m-0">{t("onScreenSetup", { name })}</p>
                <p className="m-0 font-semibold">{t("onScreenParent", { name })}</p>
              </>
            ) : (
              <>
                <p className="m-0">{t(phone ? "liveSetupPhone" : "liveSetupLaptop", { name })}</p>
                <p className="m-0 font-semibold">{t("liveSteps")}</p>
              </>
            )}
          </Card>
        </>
      }
      run={run}
      stage={({ stop, skip }) =>
        variant === "on_screen" ? (
          <Stage
            onStop={stop}
            top={trialDots()}
            controls={<ParentControls onSkip={skip} onWrong={somethingWrong} />}
          >
            {toast && <StageToast>{toast}</StageToast>}
            <OnScreenScene scene={scene} />
          </Stage>
        ) : (
          <Stage
            tone="dark"
            onStop={stop}
            top={trialDots(true)}
            background={session && <CamFeed session={session} className="absolute inset-0" />}
            controls={<ParentControls dark onSkip={skip} onWrong={somethingWrong} />}
          >
            {toast && <StageToast>{toast}</StageToast>}
            {live.phase === "place" ? (
              <div className="relative flex flex-1">
                {(["left", "right"] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    onClick={() => tap.current?.(side)}
                    aria-label={t(side === "left" ? "tapLeft" : "tapRight")}
                    className={cx(
                      "flex flex-1 cursor-pointer items-center justify-center border-0 p-4",
                      side === live.side ? "bg-amber/25" : "bg-transparent",
                    )}
                  >
                    {side === live.side && (
                      <span className="rounded-lg bg-n-900/80 px-4 py-3 text-center font-semibold text-white">
                        <Pointer aria-hidden className="mx-auto mb-1 size-7" />
                        {t("tapHere")}
                      </span>
                    )}
                  </button>
                ))}
                <p className="pointer-events-none absolute inset-x-4 bottom-4 m-0 rounded-lg bg-n-900/80 px-4 py-3 text-center text-[17px] font-semibold text-white">
                  {t(live.side === "left" ? "placeLeft" : "placeRight")}
                </p>
              </div>
            ) : (
              <div className="flex flex-1 items-end px-4" aria-live="assertive">
                <div className="w-full rounded-xl bg-amber px-5.5 py-6 text-navy-deep">
                  <p className="m-0 font-display text-[34px] leading-[1.35] font-extrabold">
                    {t("sayLook")}
                  </p>
                  <p className="m-0 text-[18px] font-medium">{t("sayLookHow", { name })}</p>
                </div>
              </div>
            )}
          </Stage>
        )
      }
    />
  );
}

/** The on-screen stimulus: ball on the left, boat on the right, the guide in the middle. */
function OnScreenScene({ scene }: { scene: Scene }) {
  const { phase, side } = scene;
  const pointing = phase === "cue" || phase === "reward";
  const pose =
    phase === "engage"
      ? "wave"
      : pointing
        ? side === "left"
          ? "point-left"
          : "point-right"
        : "idle";
  const look = pointing ? (side === "left" ? -1 : 1) : 0;
  const toy = (which: Side) =>
    cx("w-[22vw] max-w-28 min-w-18", phase === "reward" && side === which && "sj-toy-bounce");
  return (
    <div aria-hidden className="relative flex flex-1 items-end justify-between px-[4vw] pb-[16vh]">
      <div className="relative isolate mb-6">
        {phase === "reward" && side === "left" && <Glow />}
        <Ball className={toy("left")} />
      </div>
      <Character pose={pose} look={look} className="w-[30vw] max-w-44 min-w-28" />
      <div className="relative isolate mb-6">
        {phase === "reward" && side === "right" && <Glow />}
        <Boat className={toy("right")} />
      </div>
    </div>
  );
}

function Glow() {
  return (
    <span className="absolute -inset-7 -z-10 animate-[sj-breathe_1.6s_ease-in-out_infinite] rounded-full bg-[radial-gradient(circle,rgba(248,180,66,.45),rgba(248,180,66,0)_70%)]" />
  );
}
