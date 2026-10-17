"use client";

import {
  ArrowUp,
  Eye,
  Hand,
  HandMetal,
  type LucideIcon,
  MonitorSmartphone,
  Smile,
  User,
} from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Card } from "@/components/ui/card";
import { ChoiceCard } from "@/components/ui/choice-card";
import { say } from "@/lib/activities/sound";
import { sleep } from "@/lib/activities/timeline";
import type { TaskRecorder } from "@/lib/cv/capture";
import { type Action, actionSeen } from "@/lib/cv/realtime";
import { cx } from "@/lib/cx";
import type { Screening } from "@/lib/screening/rules";

import { CamFeed } from "./cam-feed";
import { useCapture, useSample } from "./capture-provider";
import { Character, type Pose } from "./character";
import { ParentControls, ParentPill, Stage, StageToast } from "./stage";
import { type RunContext, TaskFrame } from "./task-frame";
import { useToast } from "@/components/ui/use-toast";

type Variant = "on_screen" | "live";

// SCREENING_SPEC §4.6: fixed order, 3-s demonstration, 5-s response window, one retry.
const ACTIONS: { action: Action; pose: Pose; icon: LucideIcon }[] = [
  { action: "arms_up", pose: "up", icon: ArrowUp },
  { action: "clap", pose: "clap", icon: HandMetal },
  { action: "wave", pose: "wave", icon: Hand },
  { action: "touch_head", pose: "head", icon: Smile },
];
const DEMO_MS = 3000;
const RESPONSE_MS = 5000;
const PAUSE_MS = 800;
const COUNT_MS = 1000;

const DO_THIS = { bn: "এভাবে করো!", en: "Do this!" };
const SO_BIG = { bn: "এত্ত বড়!", en: "So big!" };
const COUNTDOWN = [
  { bn: "তিন", en: "Three" },
  { bn: "দুই", en: "Two" },
  { bn: "এক", en: "One" },
];

type Scene = {
  index: number;
  attempt: number;
  phase: "ready" | "count" | "demo" | "turn";
  count?: number;
};

/** Copy me (design Screening Flow 10a–b): the guide (or the parent) shows four moves; the child's
 *  turn follows each one. The device stands on a table, front camera on the child. */
export function CopyTask({ screening }: { screening: Screening }) {
  const t = useTranslations("activities.copy");
  const locale = useLocale();
  const { session, switchCamera } = useCapture();
  const [variant, setVariant] = useState<Variant>("on_screen");
  const [scene, setScene] = useState<Scene>({ index: 0, attempt: 1, phase: "ready" });
  const [toast, showToast] = useToast();
  const recorderRef = useRef<TaskRecorder | null>(null);
  const actionRef = useRef<Action>("arms_up");
  const flagged = useRef(new Set<Action>());
  const name = screening.child_name;

  // The intro shows whether the child's body is in view, so pose runs from here.
  useEffect(() => {
    if (!session) return;
    void switchCamera("front").then(() => session.usePose(true));
    return () => void session.usePose(false);
  }, [session, switchCamera]);

  async function run({ recorder, signal }: RunContext) {
    recorderRef.current = recorder;
    flagged.current = new Set();
    setScene({ index: 0, attempt: 1, phase: "ready" });
    await sleep(PAUSE_MS, signal);
    for (const [index, { action }] of ACTIONS.entries()) {
      actionRef.current = action;
      for (let attempt = 1; attempt <= 2; attempt++) {
        if (variant === "live") {
          for (const [i, number] of COUNTDOWN.entries()) {
            setScene({ index, attempt, phase: "count", count: 3 - i });
            say(number, locale);
            await sleep(COUNT_MS, signal);
          }
          setScene({ index, attempt, phase: "demo" });
        } else {
          setScene({ index, attempt, phase: "demo" });
          say(
            action === "arms_up"
              ? { bn: `${SO_BIG.bn} ${DO_THIS.bn}`, en: `${SO_BIG.en} ${DO_THIS.en}` }
              : DO_THIS,
            locale,
          );
        }
        await sleep(DEMO_MS, signal);
        setScene({ index, attempt, phase: "turn" });
        const opened = recorder.mark({ type: "response_window", action, attempt });
        await sleep(RESPONSE_MS, signal);
        // One automatic retry when the move wasn't seen (§4.6), not for a flagged one.
        if (flagged.current.has(action) || actionSeen(action, recorder.framesSince(opened.t)))
          break;
      }
      await sleep(PAUSE_MS, signal);
    }
    return { variant };
  }

  function somethingWrong() {
    recorderRef.current?.mark({ type: "something_wrong", action: actionRef.current });
    flagged.current.add(actionRef.current);
    showToast(t("wrongNoted"));
  }

  const current = ACTIONS[scene.index];
  return (
    <TaskFrame
      screening={screening}
      slug="copy"
      camera="front"
      pose
      title={t("title")}
      subtitle={t("subtitle", { name })}
      intro={
        <>
          <div role="radiogroup" aria-label={t("variantQuestion")} className="flex flex-col gap-3">
            <ChoiceCard
              name="copy-variant"
              value="on_screen"
              icon={MonitorSmartphone}
              label={t("onScreen")}
              description={t("onScreenHow", { name })}
              selected={variant === "on_screen"}
              onSelect={() => setVariant("on_screen")}
            />
            <ChoiceCard
              name="copy-variant"
              value="live"
              icon={User}
              label={t("live")}
              description={t("liveHow", { name })}
              selected={variant === "live"}
              onSelect={() => setVariant("live")}
            />
          </div>
          <Card tone="sky" className="flex flex-col gap-2">
            <p className="m-0">{t("setup", { name })}</p>
          </Card>
          {session && <BodyCheck name={name} />}
        </>
      }
      run={run}
      stage={({ stop, skip }) => (
        <Stage
          onStop={stop}
          top={
            scene.phase === "turn" ? (
              <ParentPill icon={Eye}>{t("childTurn", { name })}</ParentPill>
            ) : variant === "live" ? (
              <ParentPill icon={User}>
                {t("liveYou", { move: t(`moves.${current.action}`) })}
              </ParentPill>
            ) : undefined
          }
          controls={<ParentControls onSkip={skip} onWrong={somethingWrong} />}
        >
          {toast && <StageToast>{toast}</StageToast>}
          <CopyScene scene={scene} variant={variant} />
          <MoveStrip current={scene.index} />
        </Stage>
      )}
    />
  );
}

function CopyScene({ scene, variant }: { scene: Scene; variant: Variant }) {
  const format = useFormatter();
  const { pose } = ACTIONS[scene.index];
  if (scene.phase === "count") {
    return (
      <div className="flex flex-1 items-center justify-center" aria-live="assertive">
        <span className="font-display text-[120px] leading-none font-extrabold text-navy">
          {format.number(scene.count ?? 0)}
        </span>
      </div>
    );
  }
  // Live: the parent shows the move, so the guide just watches with the child.
  const characterPose: Pose =
    scene.phase === "demo" && variant === "on_screen"
      ? pose
      : scene.phase === "turn"
        ? "turn"
        : "idle";
  return (
    <div aria-hidden className="relative flex flex-1 items-end justify-center pb-[14vh]">
      {scene.phase === "turn" && (
        <span className="absolute bottom-[10vh] left-1/2 size-[min(72vw,300px)] -translate-x-1/2 animate-[sj-breathe_2s_ease-in-out_infinite] rounded-full border-[6px] border-amber" />
      )}
      <Character pose={characterPose} className="relative w-[40vw] max-w-52 min-w-32" />
    </div>
  );
}

/** The four moves, the current one highlighted (design `MoveStrip`). */
function MoveStrip({ current }: { current: number }) {
  const t = useTranslations("activities.copy.moves");
  return (
    <ol className="m-0 mb-2 flex list-none justify-center gap-2.5 p-0">
      {ACTIONS.map(({ action, icon: Icon }, i) => (
        <li
          key={action}
          title={t(action)}
          className={cx(
            "flex size-10 items-center justify-center rounded-full",
            i === current ? "bg-navy text-white" : "bg-white/75 text-n-500",
          )}
        >
          <Icon aria-hidden className="size-4.5" />
          <span className="sr-only">{t(action)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Setup check for Copy me (§4.6): head, shoulders and hands in the picture. */
function BodyCheck({ name }: { name: string }) {
  const t = useTranslations("activities.copy");
  const { session } = useCapture();
  const sample = useSample(session, 4);
  if (!session) return null;
  const pose = sample?.features.pose;
  const seen = (k?: [number, number, number] | null) => !!k && k[2] >= 0.5;
  const inView =
    !!pose &&
    seen(pose.l_shoulder) &&
    seen(pose.r_shoulder) &&
    (seen(pose.l_wrist) || seen(pose.r_wrist));
  return (
    <div className="flex flex-col gap-2">
      <CamFeed session={session} className="relative h-44 rounded-lg" />
      <p
        role="status"
        className={cx(
          "m-0 rounded-md px-4 py-3 font-semibold",
          inView ? "bg-leaf-50 text-leaf-ink" : "bg-amber-50 text-amber-ink",
        )}
      >
        {inView ? t("bodyOk", { name }) : t("bodyFix", { name })}
      </p>
    </div>
  );
}
