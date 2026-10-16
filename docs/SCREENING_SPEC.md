# Screening Module — Specification

Version: `screening-0.1` (POC). Everything numeric here (weights, thresholds, windows) is a **heuristic starting point**, not a validated instrument. All of it lives in `apps/api/app/scoring/config.yaml` so it can be tuned without code changes. Store `scoring_version` with every result.

---

## 1. Flow

```
Home ("Start screening")
 → Child details (new child or existing)  → Consent
 → Part 1: Questionnaire (≈ 20 items, 6–8 min)
 → Part 2: Activities with your child (camera + mic, ≈ 8–10 min, each skippable)
      Setup check → Calibration → Response to name → Look where I point
      → Copy me → Look & watch (optional) → Free play
 → Processing
 → Result: developmental concern score + class + next steps
      → Parent report · Doctor report (print / PDF / share link)
      → Ask about my results (AI chat)  → Find specialists near me
```

- Progress is saved after every item and every task; the parent can stop and resume.
- Every activity has **Skip** and **Try again**. Skipped/invalid tasks are excluded from the score (and lower confidence), never counted as "concern".
- The questionnaire alone is enough to produce a report (confidence = Low). This guarantees the POC always reaches a report.

## 2. Child details & consent

Fields: child name (or nickname), date of birth, sex (optional), who is answering (mother / father / other caregiver), language. Age is computed in months.

- Designed for **16–48 months**. 12–15 or 49–72 months: allowed with a notice that the screening was designed for younger/older children and results are less reliable. Outside 12–72: block with a kind message and the specialist finder.
- A screening creates (or reuses) a `child` record with `status = "screening"`. If the child is later diagnosed, the same record becomes a companion profile — the screening history is kept (one continuous record).
- Age is fixed in `screenings.age_months` when the screening starts; item eligibility and scoring use it throughout. The age limits live in `scoring/config.yaml` (`eligibility`); the web form mirrors them only to explain before submitting.
- Informant is stored as `mother | father | other_caregiver`; "language" is the UI locale at the start (`screenings.locale`).
- One unfinished screening per child: starting another returns 409 `screening_in_progress` with its id, and the parent continues it or deletes it ("start over").

Consent screen (must be accepted, stored with timestamp and text version). The text lives in the web messages (`screening.consent`) with a version constant (`CONSENT_VERSION`, `lib/screening/rules.ts`); the API accepts only versions listed in `CONSENT_VERSIONS` (`core/screenings.py`), so a text change means a new version in both places. Answers are refused (409 `consent_required`) until consent is stored. The sharing point must stay true: approved specialists on the care team can see screening results (COMPANION_SPEC §3.2), so the copy says "only people you allow, like a doctor on your child's care team", never "nobody unless you send it".
- This is a screening, not a diagnosis.
- Camera and microphone are used **only on this device**; video and sound are not uploaded or stored. Only measurements (numbers like "turned head after 1.2 seconds") are saved.
- The parent can delete the screening at any time.
- Results may be shared with a doctor only if the parent chooses.

## 3. Part 1 — Questionnaire

### 3.1 Answer options

Frequency items (type `freq`):

| key | en | bn | concern (P item) | concern (C item) |
|---|---|---|---|---|
| `usually` | Yes, most of the time | হ্যাঁ, বেশিরভাগ সময় | 0 | 1 |
| `sometimes` | Sometimes | মাঝে মাঝে | 0.5 | 0.5 |
| `rarely` | Rarely or never | খুব কম / কখনো না | 1 | 0 |
| `not_sure` | Not sure / haven't noticed | নিশ্চিত নই | excluded | excluded |
| `other` | Something else (write it) | অন্য কিছু (লিখে দিন) | mapped (see 3.3) | mapped |

P = positive behaviour (concern when absent). C = concern behaviour (concern when present).

### 3.2 Items

Wording is original to Shohojatri and covers the domains used by common toddler screeners. **Bangla wording needs review by a native-speaking clinician before any pilot** (add to `messages/_review.md`). `w` = weight (critical items = 2). `min_age` = months; below it the item is not shown.

| id | domain | dir | crit | w | min_age | en | bn |
|---|---|---|---|---|---|---|---|
| q01 | response to name | P | ✔ | 2 | 12 | When you call your child's name, do they look at you or respond? | আপনি যখন শিশুর নাম ধরে ডাকেন, সে কি আপনার দিকে তাকায় বা সাড়া দেয়? |
| q02 | eye contact | P | | 1 | 12 | Does your child look at your eyes when you talk or play together? | কথা বলা বা খেলার সময় শিশু কি আপনার চোখের দিকে তাকায়? |
| q03 | joint attention | P | ✔ | 2 | 12 | If you point at a toy across the room, does your child look at it? | আপনি ঘরের অন্য পাশে কোনো খেলনার দিকে আঙুল দিয়ে দেখালে শিশু কি সেদিকে তাকায়? |
| q04 | joint attention | P | ✔ | 2 | 14 | Does your child point with one finger to show you something interesting (like a bird or a plane)? | মজার কিছু দেখাতে (যেমন পাখি বা উড়োজাহাজ) শিশু কি এক আঙুল দিয়ে আপনাকে দেখায়? |
| q05 | requesting | P | | 1 | 14 | Does your child point to ask for something they want that is out of reach? | নাগালের বাইরে থাকা কিছু চাইতে শিশু কি আঙুল দিয়ে দেখায়? |
| q06 | sharing | P | | 1 | 14 | Does your child bring things to show you, just to share (not because they need help)? | শুধু আপনাকে দেখানোর জন্য (সাহায্যের জন্য নয়) শিশু কি জিনিস এনে দেখায়? |
| q07 | social smile | P | | 1 | 12 | When you smile at your child, do they smile back? | আপনি হাসলে শিশু কি পাল্টা হাসে? |
| q08 | imitation | P | ✔ | 2 | 12 | Does your child copy what you do — waving bye-bye, clapping, making a funny sound? | আপনি যা করেন — টা-টা দেওয়া, হাততালি, মজার শব্দ — শিশু কি তা নকল করে? |
| q09 | pretend play | P | | 1 | 20 | Does your child play pretend, like feeding a doll or talking on a toy phone? | শিশু কি "ভান করে" খেলে, যেমন পুতুলকে খাওয়ানো বা খেলনা ফোনে কথা বলা? |
| q10 | peer interest | P | ✔ | 2 | 14 | Is your child interested in other children — watching them, smiling at them, going near them? | অন্য শিশুদের প্রতি কি তার আগ্রহ আছে — তাকিয়ে দেখে, হাসে বা কাছে যায়? |
| q11 | showing off | P | | 1 | 16 | Does your child try to get you to watch them ("look at me!")? | শিশু কি চায় আপনি তাকে দেখুন (যেমন "আমাকে দেখো!" বোঝায়)? |
| q12 | understanding | P | | 1 | 18 | Does your child follow a simple instruction without you pointing (like "bring the ball")? | আঙুল দিয়ে না দেখালেও শিশু কি সহজ কথা বোঝে (যেমন "বলটা নিয়ে এসো")? |
| q13 | language | — | | 1.5 | 12 | How does your child mostly communicate? *(single choice, see 3.4)* | শিশু বেশিরভাগ সময় কীভাবে নিজের কথা বোঝায়? |
| q14 | social referencing | P | | 1 | 14 | When something new or surprising happens, does your child look at your face to see how you react? | নতুন বা অবাক করা কিছু ঘটলে শিশু কি আপনার মুখের দিকে তাকিয়ে আপনার প্রতিক্রিয়া দেখে? |
| q15 | repetitive movement | C | | 1 | 12 | Does your child flap their hands, rock their body, or move their fingers near their eyes again and again? | শিশু কি বারবার হাত ঝাপটায়, শরীর দোলায়, বা চোখের কাছে আঙুল নাড়ায়? |
| q16 | repetitive play | C | | 1 | 16 | Does your child line up toys or repeat the same action with an object for a long time (like spinning wheels)? | শিশু কি অনেকক্ষণ ধরে খেলনা সারি করে সাজায় বা একই কাজ বারবার করে (যেমন চাকা ঘোরানো)? |
| q17 | sensory (sound) | C | | 1 | 12 | Does your child get very upset by everyday sounds (pressure cooker, blender, vehicle horn)? | দৈনন্দিন শব্দে (প্রেশার কুকার, ব্লেন্ডার, গাড়ির হর্ন) শিশু কি খুব অস্থির হয়ে পড়ে? |
| q18 | sensory (other) | C | | 1 | 12 | Does your child stare at lights or spinning things, or smell or lick objects much more than other children? | শিশু কি অন্য শিশুদের চেয়ে অনেক বেশি আলো বা ঘুরন্ত জিনিসের দিকে তাকিয়ে থাকে, বা জিনিস শোঁকে বা চাটে? |
| q19 | regression | C | red flag | 2 | 12 | Has your child stopped using words or skills they used to have? *(options: no / yes / not sure / other)* | শিশু আগে যে শব্দ বা দক্ষতা ব্যবহার করত, তার কোনোটি কি এখন আর করছে না? |
| q20 | hearing | info | | 0 | 12 | Has your child's hearing been checked? *(options: yes–normal / yes–a problem was found / no / not sure)* | শিশুর কানে শোনার পরীক্ষা কি করা হয়েছে? |

- **q19** options: `no` (0) / `yes` (1) / `not_sure` (excluded) / `other`. Any `yes` → red flag (§6.3).
- **q20** is not scored. It feeds recommendations (§6.3).
- After the last item, an optional free-text box: "Anything else you've noticed?" / "আর কিছু কি লক্ষ্য করেছেন?" — shown verbatim in the doctor report, not scored. Stored as `screenings.parent_note` when the parent finishes Part 1 (`POST /screenings/{id}/questionnaire`), which needs a final answer to every shown item ("Not sure" counts) and sets `questionnaire_completed_at`.
- Items are versioned content in `apps/api/app/seed/questionnaire.yaml` (`version: questionnaire-0.1`), loaded at runtime rather than stored in the database; answer cards per item type are fixed in `scoring/items.py`.
- Show one item per screen on mobile with large tap targets; show an illustration per item (designed in Claude Design). Allow back navigation.

### 3.3 "Other" answers

When the parent writes their own answer, call the LLM (`ai/prompts/answer_mapper.md`) with the item text and the answer. The allowed outputs are **the item's own option keys** plus `unclear` (enforced by the structured-output schema), so q13 maps to `sentences|single_words|sounds_gestures|little` and q19 to `no|yes|not_sure`. It returns `{ "mapped_option": ..., "confidence": 0-1, "short_reason": "..." }`, the reason written in the parent's current language (`users.preferred_locale`). Show: "We understood this as **Sometimes** — is that right?" with buttons to confirm or pick another option. Store both the free text (verbatim) and the confirmed option. If the LLM is unavailable (no key, error, timeout) or answers `unclear`: ask the parent to pick the closest option; if they can't ("I can't choose"), store `not_sure` (excluded from scoring, accepted on every scored item for this purpose even where it isn't a card, e.g. q13).

Storage: `map-other` saves the words as a pending answer (`option = "other"`, `ai_mapping_json` = the suggestion), which survives a reload but doesn't count as answered. Confirming saves the chosen card with the same text; `mapped_by_ai` is true when that card is the AI's suggestion for those exact words. q20 is unscored, so its "Other" text is stored as the answer without mapping (`option = "other"`).

### 3.4 q13 (communication) scoring

Options: `sentences` (2+ words together) / `single_words` / `sounds_gestures` (sounds, gestures, pulling your hand) / `little` (rarely tries to communicate) / `other`.

| age (months) | sentences | single_words | sounds_gestures | little |
|---|---|---|---|---|
| < 18 | 0 | 0 | 0.25 | 1 |
| 18–23 | 0 | 0 | 0.5 | 1 |
| 24–29 | 0 | 0.25 | 0.75 | 1 |
| ≥ 30 | 0 | 0.5 | 1 | 1 |

### 3.5 Questionnaire score

`Q = Σ wᵢ·cᵢ / Σ wᵢ` over answered, age-eligible items (c = concern 0–1). If fewer than 80% of eligible items have a scorable answer, Q is still computed but confidence drops one level.
A critical item is **failed** when its concern = 1.

## 4. Part 2 — Activities (camera + microphone)

### 4.1 Capture & per-frame features (browser, `lib/cv/`)

- MediaPipe Tasks Vision in `VIDEO` running mode, GPU delegate with CPU fallback; process at ~15 fps (skip frames as needed). Load models lazily on the activities route; show a friendly loading state.
- `FaceLandmarker` with `outputFaceBlendshapes` and `outputFacialTransformationMatrixes` on; `numFaces: 2` (pick the **smallest/lowest face** as the child when two faces are present, and let the parent tap to confirm the child's face during setup check).
- `PoseLandmarker` (lite) only for Copy me and Free play. `HandLandmarker` optional.
- `AudioClassifier` (YAMNet) on 1-s windows + raw RMS every 50 ms.
- Never record or upload video/audio. Keep a rolling in-memory buffer only.

Per-frame record sent to the API (downsampled to 10–15 Hz):

```json
{ "t": 1234,                 // ms since task start
  "face": true,
  "yaw": -12.4, "pitch": 3.1, // degrees, from facial transformation matrix
  "nose_dx": -0.08,           // nose-tip x minus cheek-midpoint x, / inter-ocular distance (robust turn-direction sign)
  "iris_x": 0.12, "iris_y": -0.03, // mean iris offset within eye, normalised −1..1
  "eye_open": 0.9,            // 1 − mean(eyeBlinkLeft, eyeBlinkRight)
  "iod": 0.061,               // inter-ocular distance / frame width (face size → distance check)
  "pose": { "nose":[x,y,v], "l_ear":[...], "r_ear":[...], "l_shoulder":[...], "r_shoulder":[...],
            "l_elbow":[...], "r_elbow":[...], "l_wrist":[...], "r_wrist":[...], "l_hip":[...], "r_hip":[...] },
                              // only when pose is on; x and y both divided by frame WIDTH, v = visibility
  "rms_db": -38.2 }           // RMS of the latest 50 ms of audio, dBFS
```

Plus per-task `markers` (prompt shown, stimulus phase changes, parent taps), `audio_events` (`[{t, label, score}]` for YAMNet top classes), `device` (camera facing, resolution, fps achieved, user agent), `quality` (§4.9).

**Coordinate convention:** image coordinates are as captured (un-mirrored), x right, y down. The front-camera preview is shown mirrored to the user, but features are computed on un-mirrored frames. Verify the sign of `yaw` against `nose_dx` with a quick manual test and document it in `lib/cv/README.md`.

Signs the scorer relies on (the browser normalises to them): `yaw` > 0 when the child turns toward **their own right**, which on an un-mirrored frame moves the nose toward image left, so `nose_dx` < 0; `iris_x` > 0 when the irises sit toward image right. Pose `y` is divided by the frame width like `x` (MediaPipe gives y / height: multiply by height / width), so distances in shoulder widths mean the same in both directions.

**Markers** (`{t, type, …}`, `t` in ms since task start; `scoring/inputs.py`):

| type | task | fields | meaning |
|---|---|---|---|
| `target` | calibration | `position` left/centre/right | the star moves |
| `prompt` | rtn | `trial`, `pre_state` away/facing | "Call [name] now" shown |
| `engage` | joint_attention (on-screen) | `trial`, `side` | engage phase starts |
| `cue` | joint_attention | `trial`, `side` | on-screen: the character points; live: the parent taps the toy's side |
| `response_window` | imitation | `action`, `attempt` (2 = the automatic retry) | response window opens |
| `stimulus` | gaze_preference | `social_side` | stimulus starts, or the sides swap |
| `end` | joint_attention, gaze_preference | | stimulus ends |
| `something_wrong` | any | `trial` or `action` | parent tapped "Something went wrong": that trial/action is excluded |

`side` is the target's screen side as the child sees it (on-screen) or its side in the camera image (live).

*Browser details (B6, `apps/web/src/lib/cv/README.md`).*
- **Routes:** `/screening/[id]/activities/[task]`, with `task` = `setup`, `calibration`, `name-call`, `point`, `copy`, `look`, `free-play` or `analysing`.
- **One camera session for all of them.** Leaving the activities, or reaching `analysing`, turns the camera off. After a reload, any game page asks for the camera again (K1) and carries on.
- **The next game** is the first one in §1 order with no upload yet.
- **Microphone:** raw levels (no echo cancellation, noise suppression or gain control), so voice onset and room noise stay measurable.
- **Upload `quality`:**
  - `mean_luma` is the task's mean frame luma, sampled every 0.5 s.
  - `noise_db` is the 20th percentile of the task's 50-ms RMS readings: the room under any talking.
- **Upload `device`:** camera front/rear as reported by the track (a laptop's single camera counts as front), `device_type` from the setup check, video size, frames per second achieved, and the user agent.
- **Audio events:** YAMNet's top 3 classes per 1-s window, sent for every task (only free play uses them).
- **Model downloads:** WASM and models are self-hosted by the web app under `/models/<mediapipe-version>/` (fetched and hash-checked at build time; cached for a year, and cache-first in the service worker). They are prefetched in the background while the parent answers the questionnaire, unless the browser asks to save data.

### 4.2 Setup check (≈ 30 s)

Checks with live friendly feedback: camera permission, mic permission, light level (mean frame luma ≥ 60/255 → else "Please turn on a light or move near a window"), child's face found (`iod` ≥ 0.035 → else "Move a little closer"), background noise (RMS baseline < −35 dBFS → else "It's a bit noisy — turn off the TV/fan if you can"). Parent picks device type: phone or laptop/tablet on a table.

*Browser details (B6).*
- **The checks update live** on the front camera.
- **Thresholds:** noise is the median of the last 3 s of 50-ms RMS readings; "face found" means the chosen face's `iod` ≥ 0.035.
- **Two faces:** each face gets a tappable box. The tapped face is followed from frame to frame (nearest face within 0.25 of the frame). Without a tap the smaller face is used, and of two faces about the same size, the lower one.
- **Device type:** the parent picks it, with a guess from the user agent. A phone holds the rear camera for the name game and live pointing; a laptop or tablet uses its one camera for everything.
- **Continuing:** the parent may always go on ("Continue anyway"); the scorer's quality rules handle poor capture.

### 4.3 Calibration (front-camera tasks, ≈ 6 s)

A bright animated star with a soft sound moves to **left → centre → right → centre**, 1.5 s each. For each position take the median of `yaw`, `nose_dx`, `iris_x` over the last 1 s. Fit `gaze_x = a·yaw + b·iris_x + c` by least squares to targets −1, 0, +1 (screen space; −1 = screen left as the child sees it). Valid if face present ≥ 70% of each segment and the left/right medians differ in the expected direction. If calibration fails: retry once, then fall back to `gaze_x = yaw / 25` (clamped) and mark `calibration: "fallback"` (quality → low for gaze tasks).

The API fits it (`scoring.fit_calibration`), so there is one implementation: the browser uploads the calibration recording like a task (`task = "calibration"`, a `screening_tasks` row, OPEN_QUESTIONS #14) and gets the status back to decide the retry. "Expected direction": looking at screen left (the child's own left) gives a higher median `nose_dx` (head turn) or `iris_x` (eyes only) than looking right, and the fitted line must put left below right. Fallback reasons: `face_not_visible`, `wrong_direction`, `missing_targets`. A gaze task scored without a calibration uses the fallback.

*Browser details (B6).* A 0.5-s settle with the star in the centre, then the four 1.5-s targets with a soft chime each. The browser retries once by itself on `fallback`; an `ok` calibration goes straight to the next game.

### 4.4 T1 — Response to name (`rtn`)

**Setup.** Child is busy with a toy. The **parent is the caller and holds the phone** (rear camera pointing at the child) about 1–1.5 m away, slightly to the side of the child's line of sight. On laptop/tablet: device on a table facing the child, the parent stands directly behind the device. Screen tells the parent: "Say [name] once, in your normal voice. Don't wave or touch."

**Trial (×3, 15–30 s apart).**
1. Gate: wait until the child is **looking away** (face absent, or |yaw| > 30°) for ≥ 1.5 s. Then show **"Call [name] now"** (large, high-contrast; gentle vibration on phones). If the child never looks away within 20 s, allow the call but mark `pre_state: "facing"` → trial excluded.
2. `t0` = voice onset: first 50-ms window after the prompt where `rms_db` exceeds the median of the previous 2 s by ≥ 12 dB, within 4 s of the prompt. If not found: `t0 = prompt + 800 ms`, flag `t0_estimated`.
3. **Facing caller** state = face present and |yaw| ≤ 20° and |pitch| ≤ 25° (the caller is at the camera), sustained ≥ 300 ms.
4. `latency` = time from `t0` to the start of the first facing-caller state, searched in [t0, t0 + 5000 ms].
5. Record `eye_contact_ms` = duration of that facing state (cap 3000).

**Trial concern:** latency ≤ 2000 → 0 · 2000–3000 → 0.25 · 3000–5000 → 0.5 · no response → 1.
**Valid trial:** not `pre_state: facing`, face visible ≥ 60% of the 2 s before `t0`, parent did not press "Something went wrong".
**Task score:** mean trial concern over valid trials. Needs ≥ 2 valid trials, else `inconclusive`.

*Scoring details.* Durations are time-based: a frame's state holds until the next frame, but at most 250 ms (`signals.max_hold_ms`), so dropped frames count as "not seen". The onset baseline slides: each candidate sample is compared with the median of the 2 s before it. A facing state already under way at `t0` counts from `t0` (latency 0). Latency bands include their upper limit (exactly 2000 ms → 0). The same voice-onset rule (`voice_onset` in config) serves T2b.

Report text examples: "Rafi turned toward his name in 1 of 3 tries (after about 2.8 seconds)." / "রাফি ৩ বারের মধ্যে ১ বার নাম শুনে ফিরে তাকিয়েছে (প্রায় ২.৮ সেকেন্ড পরে)।"

*Browser details (B6).*
- **Timing:** each call waits at least 15 s after the previous prompt, then up to 20 s for the gate. After the prompt, "Call now" stays up for 2.5 s, and the trial lasts 9 s in all (onset search 4 s + response window 5 s).
- **Prompt:** a 250-ms vibration where supported.
- **"Something went wrong"** marks the current trial and adds one more, up to 5 calls in all.

### 4.5 T2 — Look where I point (`joint_attention`)

Two variants; the parent chooses. **On-screen is the default** (more standardised).

**T2a — On-screen video (default).** Front camera; child sits on the parent's lap 40–60 cm from the screen. Parent is asked to look down at the child's head (not at the screen) so they don't cue the child.

Stimulus (an animated, culturally familiar friendly character in the centre and two toys — e.g. a ball and a toy boat — at the far left and right; built as SVG/Lottie or short video, no external real-person video in the POC):

| phase | time (s) | what happens |
|---|---|---|
| engage | 0 – 1.5 | character looks at the child, waves, voice: "দেখো!" / "Look!" |
| cue | 1.5 | character turns head **and** points to the target toy (toys are still) |
| window | 1.5 – 3.5 | measurement window — nothing else moves |
| reward | 3.5 – 5.0 | target toy bounces with a happy sound |

6 trials, target side balanced 3/3, never more than 2 in a row on the same side.

Measurement on calibrated `gaze_x`: **first look** in the window = first time |gaze_x| > 0.35 held ≥ 200 ms. Trial `followed` if the first look is on the target side.
Valid trial: face present ≥ 70% of the window **and** the child attended the centre (|gaze_x| < 0.3 for ≥ 300 ms) during the engage phase.
`follow_rate = followed / valid`. **Concern** = linear: follow_rate ≥ 0.75 → 0; ≤ 0.25 → 1. Needs ≥ 4 valid trials.

*Scoring details (T2a).* The window starts at the `cue` marker; centre attention is searched between `engage` and `cue` (1.5 s before the cue if `engage` is missing). A look already under way at the cue counts from the cue; its side is the sign of the median `gaze_x` during it. A valid trial with no look counts as not followed.

**T2b — Live pointing (with me).** Parent holds the phone (rear camera on the child) with one hand; a favourite toy is placed about 1 m to the child's left or right. Parent taps the side of the screen where the toy appears in the camera view, then says "দেখো!" and points with the other hand. Window 0–3 s after voice onset. `followed` if the child's head turns ≥ 20° from its pre-cue baseline yaw toward that image side (use `nose_dx` for direction), sustained ≥ 300 ms. 4 trials (2 per side), same concern mapping, needs ≥ 3 valid trials.

*Scoring details (T2b).* `t0` is found as in T1, searching from the tap. The baseline is the median `yaw` and `nose_dx` over the 1 s before `t0`; with no face there the trial is invalid (`no_baseline`). A turn is |yaw − baseline| ≥ 20° held ≥ 300 ms; its side is the sign of the median `nose_dx` shift during it (negative = image left). Valid if the face is present ≥ 70% of the window, as in T2a.

*Browser details (B6).*
- **On-screen trials:** 6, in a random order with 3 per side and never 3 in a row on one side. A 1-s lead-in, then engage (wave + "দেখো!") / cue (point + head turn) / window / reward (the toy bounces, with a chime arpeggio), plus a 1-s rest between trials.
- **Live trials:** 4, with 2 per side. The screen asks for the toy on one side; the parent taps that side of the picture, then says "দেখো!" and points. The trial lasts 7 s from the tap. A tap on a mirrored (front camera) preview is converted to the image side.
- **"Something went wrong"** marks the trial and repeats it on the same side, at most twice.

### 4.6 T3 — Copy me (`imitation`)

**Default: on-screen model.** Device on a table, front camera; child 1.2–1.5 m away so head, shoulders and hands are visible (setup check confirms pose landmarks for shoulders and wrists). **Live variant:** the parent demonstrates beside the device after a spoken 3-2-1 countdown.

Actions (fixed order): `arms_up` ("এত্ত বড়!" / "So big!"), `clap`, `wave`, `touch_head`. Each: 3 s demonstration with voice "এভাবে করো!" / "Do this!", then a 5 s response window while the character smiles and waits. One automatic retry for actions not detected.

Detection on pose keypoints (normalised; `sw` = shoulder width):
- `arms_up`: both wrists above the nose (y smaller) for ≥ 400 ms.
- `clap`: wrist–wrist distance goes < 0.35·sw then > 0.6·sw at least twice.
- `wave`: one wrist above its shoulder and its x reverses direction ≥ 2 times with amplitude ≥ 0.25·sw within 2 s.
- `touch_head`: a wrist within 0.5·sw of the nose/ears and above the shoulder line for ≥ 300 ms.
- `attempt`: any wrist moves > 0.3·sw during the window but the rule isn't met.

**Action concern:** detected → 0 · attempt → 0.5 · nothing → 1. Valid if pose present ≥ 60% of window. **Task score** = mean over valid actions; needs ≥ 3 valid.

*Scoring details.* Pose present = both shoulders and at least one wrist with visibility ≥ 0.5. Keypoints are smoothed with a 3-frame running median; `sw` = median shoulder width in the window. `touch_head` uses the nose and both ears. `wave` counts reversals with a zig-zag filter: each needs a swing (peak to trough) of ≥ 0.25·sw. `attempt`: a wrist ends up > 0.3·sw from where it started (median of its first 3 samples). The browser decides the automatic retry in real time; the scorer scores every response window and keeps the action's best outcome over windows with enough pose.

*Browser details (B6).*
- **The retry decision** (`lib/cv/realtime.ts`) applies the four rules above without smoothing to the window's frames. It only decides whether to repeat.
- **"Something went wrong"** marks the action, which is then excluded, so it is not repeated.
- **Live variant:** a spoken "তিন, দুই, এক" countdown, 1 s each, then the parent's 3-s demonstration, then the 5-s window; the on-screen guide stays idle.
- **Intro check:** shows whether the shoulders and a wrist are in view.

### 4.7 T4 — Look & watch (`gaze_preference`, optional, 40 s)

Front camera, uses calibration. Split screen: one side shows animated children singing/dancing to a traditional Bangla rhyme (social); the other shows moving colourful geometric patterns with music (non-social). Sides swap at 20 s. Compute share of valid gaze samples on the geometric side (`gaze_x` sign).
**Concern** = linear: geo share ≤ 0.5 → 0; ≥ 0.8 → 1. Valid if gaze tracked ≥ 50% of the time.
*Scoring details.* The stimulus runs from the first `stimulus` marker to `end`; "tracked" = face found (share of time); gaze exactly 0 counts for neither side.
Note in the clinician report: published work on this paradigm used real-video stimuli; this animated version is not validated (hence low weight).

*Browser details (B6).* SVG stand-ins: three dancing children on the social side and floating, spinning shapes on navy, with a gentle synthesized tune on both halves (OPEN_QUESTIONS #7). Markers: `stimulus` (left) at 0, `stimulus` (right) at 20 s, `end` at 40 s.

### 4.8 T5 — Free play (`free_play`, 2 min)

Device on a table, child plays with their own toys, parent plays and talks normally. Pose on, audio classifier on.

- **Repetitive arm/hand movement episode**: per wrist, x and y normalised by `sw`, sliding window 3 s, step 0.5 s, detrend; dominant frequency 1.5–6 Hz with peak-power share > 0.5 and amplitude > 0.15·sw. Merge overlapping windows into episodes.
- **Rocking episode**: shoulder-midpoint x (and `sw` as a depth proxy), dominant frequency 0.4–1.5 Hz, peak-power share > 0.5, amplitude > 0.1·sw, ≥ 4 s.
- **Vocalisation** (report only, not scored in POC): seconds classified as `Child speech, kid speaking`, `Babbling`, `Laughter`, `Speech`, `Singing`.

**Concern:** 0 episodes → 0 · 1 → 0.3 · 2–3 → 0.6 · ≥ 4 or ≥ 15 s total → 1. Valid if pose present ≥ 60% of the time.
Report wording: "Repeated upper-body movement was observed 2 times during play." Never "stimming" or diagnostic labels.

*Browser details (B6).* A 2-minute timer on the parent's page, with a small preview and an "in the picture" pill. "Finish early" uploads what was captured, with an `end` marker. For the games without trials (calibration, Look & watch, free play), "Something went wrong" stops the game and returns to its intro to play again.

*Scoring details.* Signals are resampled to 15 Hz; a window is analysed only if its keypoints were seen in ≥ 80% of its frames. "Peak-power share" = power in the peak bin and its two neighbours over all power except DC, so a rhythm that falls between two bins still counts; "amplitude" = that of a sinusoid with the peak's power. Rocking uses 5-s windows (two cycles at 0.4 Hz). Overlapping windows (any wrist and axis, or either body signal) form one episode, which lasts as long as the band-passed movement stays above the amplitude threshold: a short burst can dominate an otherwise still window, so window edges would overstate it. Rocking episodes under 4 s are dropped. Vocal seconds = 1-s windows whose **top** YAMNet class is in the list. Play without episodes gives no finding: the absence of a concern behaviour is not reported as a strength.

### 4.9 Quality & validity

Each task returns `quality = { face_pct, pose_pct, mean_luma, noise_db, calibration, valid_trials, status: "ok" | "low" | "inconclusive" }`. `inconclusive` tasks are excluded from the score and listed in reports with a reason ("Not enough light", "Child's face was not visible", "Skipped").

The scorer sets `face_pct` / `pose_pct` (0–1), `calibration`, `valid_trials`, `status` and, when inconclusive, `reason`: `skipped | no_data | face_not_visible | body_not_visible | gaze_not_tracked | not_enough_valid_trials`. `mean_luma` and `noise_db` come from the browser's upload and are stored with the task, where the report can turn them into "Not enough light". A task with enough valid trials is `low` when the face (or pose) was seen less than 80% of the time (`quality.low_presence_share`), or when a gaze task used the calibration fallback. For T1 presence is measured in the 2 s before each call, since the gate makes the child look away in between.

## 5. Scoring engine (`apps/api/app/scoring/`)

Pure functions, no I/O:

```
fit_calibration(frames, markers, cfg) -> Calibration
detect_rtn(frames, markers, cfg) -> TaskResult
detect_joint_attention(frames, markers, calibration, cfg, *, variant="on_screen"|"live") -> TaskResult
detect_imitation(frames, markers, cfg) -> TaskResult
detect_gaze_preference(frames, markers, calibration, cfg) -> TaskResult
detect_free_play(frames, audio_events, cfg) -> TaskResult
skipped(task) -> TaskResult                 # inconclusive, reason "skipped"
score_questionnaire(answers, age_months, items, cfg) -> QuestionnaireResult
combine(questionnaire, tasks, cfg) -> RiskResult
```

Inputs are `scoring/inputs.py` (`Frame`, `Marker`, `AudioEvent`), results `scoring/results.py` (Pydantic, stored as JSON).

`TaskResult = { task, status, concern (0–1|null), metrics {...}, trials [...], quality {...}, findings [ {key, params, polarity: "concern"|"strength", source, points} ] }` — `findings` are i18n keys + params used to write report sentences (no LLM needed for the report). Trials are typed by `kind`: `rtn`, `joint_attention`, `imitation`, `movement_episode` (free play).

| finding key | params | polarity |
|---|---|---|
| `findings.rtn.responded` | `responded`, `valid`, `latency_s` (mean, 1 decimal) | strength when concern = 0, else concern |
| `findings.rtn.no_response` | `responded` (0), `valid` | concern |
| `findings.joint_attention.followed` | `followed`, `valid` | strength when concern = 0, else concern |
| `findings.imitation.copied` | `copied`, `attempted`, `valid` | strength when concern = 0, else concern |
| `findings.gaze_preference.social` | `geometric_pct` | strength |
| `findings.gaze_preference.geometric` | `geometric_pct` | concern |
| `findings.free_play.repetitive_movement` | `episodes`, `seconds` | concern |
| `findings.items.{q01…q19}` | `option` | concern when the item's concern > 0; strength when 0 (P items and q13 only) |

Recommendation keys in `RiskResult.recommendations`, most important first: `recommendations.class.{low|moderate|elevated|high}` (or `recommendations.incomplete` when nothing was scorable), then `recommendations.regression`, `recommendations.hearing_test`.

The web strings live under the same keys in `messages/{bn,en}.json` (`findings.*`, `recommendations.*`); the renderer adds the child's `name`. Item findings have a `concern` and a `strength` sentence (`findings.items.q01.concern`), chosen by the finding's polarity; "C" items and q19 have only `concern`. The doctor report reuses the parent-facing sentences and shows their source as the item id (Q07) or the activity name.

**Where scoring runs.** An upload (§10) is scored at once, so the browser can offer "Try again" or retry a calibration that fell back. Finalize scores every stored task again from its stored features, with the latest calibration and the current config (`core/screening_results.py`), so the order the parent did the activities in never matters. A task with no upload counts as `skipped`.

## 6. Combining into a result

### 6.1 Weights (renormalised over what is available and valid)

| component | weight |
|---|---|
| Questionnaire `Q` | 0.45 |
| `rtn` | 0.15 |
| `joint_attention` | 0.15 |
| `imitation` | 0.10 |
| `gaze_preference` | 0.10 |
| `free_play` | 0.05 |

`score = 100 × Σ wₖ·concernₖ / Σ wₖ` over the questionnaire plus valid tasks. Round to an integer (halves up). The questionnaire counts when it has a score (at least one scorable answer). With nothing scorable, score and class are empty and the result recommends completing the screening.

### 6.2 Classes (configurable)

| class | score | parent headline (en / bn) | recommendation |
|---|---|---|---|
| Low | 0–20 | Few early signs today / আজ খুব কম প্রাথমিক লক্ষণ দেখা গেছে | Keep enjoying everyday play and watching milestones. Screen again in 3–6 months, or any time you are worried. |
| Moderate | 21–45 | Some early signs / কিছু প্রাথমিক লক্ষণ দেখা গেছে | Talk to a child doctor within about a month and show this report. Screen again in 1–2 months. |
| Elevated | 46–70 | Several early signs / বেশ কিছু প্রাথমিক লক্ষণ দেখা গেছে | We recommend a developmental assessment by a specialist in the next few weeks. |
| High | 71–100 | Many early signs / অনেকগুলো প্রাথমিক লক্ষণ দেখা গেছে | Please arrange a developmental assessment with a specialist soon. Early support makes a real difference. |

Moderate and above: show "Find a specialist near me" prominently and "Share report with a doctor".

### 6.3 Red flags and floors (applied after the score)

- `q19` regression = yes → class at least **Moderate**, and always add: "Losing words or skills should be checked by a doctor soon, whatever the score."
- ≥ 3 failed critical items → class at least **Elevated**.
- `rtn` concern ≥ 0.75 or `q01` failed, **and** `q20` ≠ yes–normal → add recommendation: hearing test.
- Floors are shown in the clinician report ("class raised from Moderate to Elevated because…").

### 6.4 Confidence

1. Base level from the valid (not inconclusive) tasks: **High** if ≥ 3 and none `low`; **Medium** if ≥ 1 and fewer than half are `low`; else **Low** (questionnaire only, or mostly low-quality tasks).
2. If fewer than 80% of the questionnaire's eligible items have a scorable answer (§3.5), drop one level (never below Low).

Parent copy for Low: "This result is based mostly on your answers. For a clearer picture, try the activities again in good light."

### 6.5 Strengths and concerns for the report

Rank task and item findings by contribution (`weight × concern`), take the top 3 concerns; take up to 3 strengths (items/tasks with concern = 0, prefer critical domains). Every report shows at least one strength if any exists.

Contribution is a finding's `points`: its share of the 0–100 score (a task: renormalised weight × concern × 100; an item: the questionnaire's share × wᵢ / Σw × cᵢ × 100). Strengths come from P items and q13 with concern 0, and from tasks whose finding is a strength. "C" items, q19 and free play describe concerns, so their absence is never listed as a strength. Strength order: critical domains first (critical items; `rtn`, `joint_attention`, `imitation`), then by the points the source would carry at full concern.

## 7. Reports

Both reports are generated from the stored `RiskResult` (deterministic; no LLM needed) and rendered as print-optimised pages in the web app (`GET /screenings/{id}/report?audience=`). "Download PDF" uses the browser print dialog (reliable Bangla shaping); pages print on A4 (`@page` in `globals.css`) without the app chrome. Server-side PDF is out of scope for the POC. Both carry a report number `SJ-{yymm}-{id}` (finalize month, screening id), never the Child ID. The `parent` audience leaves out the parent's free-text note and the device details; answers, capture quality and the result are the same for both.

**Result screen** (`/[locale]/screening/{id}/result`, parent): the parent report's content on one phone screen, plus "Share with doctor" (share sheet), links to both printable reports, and "Find specialists" / "Ask about my results" shown as coming soon until §8 is built. Sharing is the primary action from Moderate up.

**Labels.** The class badge shows the class name (Low / Moderate / Elevated / High, কম / মাঝারি / বাড়তি / উচ্চ) next to the gauge captioned "early-signs score" and the line "the score reflects how many early signs we noticed today, not the chance of having autism". The design's "… ঝুঁকি" (risk) badge labels are not used (CLAUDE.md §2 rule 2).

**Parent report** (`/[locale]/screenings/{id}/report`), in the parent's language:
logo header · child name, age, date · class badge (colour + icon + label) and score gauge · "What this means" (2–3 sentences, always says it is not a diagnosis) · "What we noticed" (top concerns in plain words) · "What went well" (strengths) · next steps for the class · buttons: Share with doctor, Find specialists, Ask about my results · confidence note · footer disclaimer.

**Doctor report** (`/[locale]/screenings/{id}/clinician`, for the parent and specialists on the care team), English by default with a বাংলা toggle (`?lang=bn`: the report has its own language, independent of the app's):
identifiers (child name, DOB, age in months, sex, informant, date, device, app & scoring version) · summary (score, class, floors applied, confidence) · questionnaire table (item, answer, concern, critical flag, "Other" text verbatim + confirmed mapping, the parent's free-text note) · per-task section (status, metrics, trial table with latencies/first looks/detections, quality) · red flags & recommendations · method note (weights, thresholds, "heuristic POC, not a validated instrument, not diagnostic") · QR code + link to the online version.

**Sharing:** `report_shares` with a random URL-safe token (32 bytes), stored only as its SHA-256, default expiry 30 days (the share sheet also offers 24 hours and 7 days), revocable by the parent, view count + last viewed. Because only the hash is kept, a link is shown once, when it is made; later the parent makes a new one rather than reopening an old one, and revokes by link id. Every successful open of the public link counts as a view. Public read-only route `/[locale]/share/{token}` shows the doctor report without login (not indexed by search engines); expired, revoked and unknown links each show their own message. The QR code on the printed reports encodes a link made in the same session ("Add a QR code" makes a 30-day link); without one, nothing prints there. If the specialist is on Shohojatri, the parent can instead share in-app (grants access to that screening via the normal access flow; OPEN_QUESTIONS #10, not built yet).

## 8. After the result

**Ask about my results** — chat seeded with only this screening's `RiskResult`, answers and class definitions (`ai/prompts/results_explainer.md`). Suggested chips: "এই ফলাফলের মানে কী?" · "আমি এখন কী করব?" · "ডাক্তারকে কী জিজ্ঞেস করব?" · "বাড়িতে কী খেলতে পারি?". Rules: explain in plain language, never diagnose, never say the child does or doesn't have autism, encourage professional assessment per class, be warm and non-alarming.

Built in B8:
- Parent only (`write:screenings`), on a finalized screening, at `/[locale]/screening/{id}/chat`. One conversation per parent per screening (`conversations.mode = results`), kept so the chat is still there on return; deleting the screening deletes it.
- The prompt is `results_explainer.md` followed by `safety.md`, plus a JSON block of this screening only: age, informant, date, demo flag, result (score, classes, floors, confidence, recommendation keys, score parts, top concerns, strengths), class bands from `config.yaml`, every shown item with its answer (and the parent's own words), the parent's note and each task's status, metrics and findings. Never the child's name (the reply says "your child"), other screenings or the companion record. The latest 12 messages go back with each question.
- `POST /screenings/{id}/chat` `{message (1–1000 chars), locale}` streams SSE: `delta {text}` …, then `done {message_id}` or `error {message_key}`. The question and reply are saved together only when the reply completes. Errors before the stream starts are normal JSON errors: 503 `ai_not_configured`, 429 `ai_quota_exceeded` (daily cap), 502 `ai_unavailable`. `GET /screenings/{id}/chat` returns the history and `ai_available`.
- The reply is plain text in the app's current language. No urgent-situation card yet (that is COMPANION_SPEC §13.4, B11); the safety rules make the reply say "call 999" itself.

**Find specialists near me** — *not built (decision in B8: not needed for now); the result screen shows it as "coming soon".* `GET /api/v1/specialists/nearby?lat=&lng=&type=&radius_km=`. Location from browser geolocation (ask permission) or a division picker (8 divisions, approximate centroids). Types: developmental paediatrician, child neurologist, child psychiatrist, child psychologist, speech & language therapist, occupational therapist, special school. Sort by haversine distance. Map (Leaflet + OSM) + list cards (name, type, distance, address, phone tap-to-call, "On Shohojatri" badge for registered specialists). POC seed entries are fictional and marked "Sample".

## 9. Demo mode & fixtures

`scripts/make_fixtures.py` generates synthetic frame streams for every task in two profiles — `typical` and `elevated` — plus a `noisy` profile (low light, face often missing). They are used by pytest and by **demo screening mode**, which skips the camera and replays a fixture with a short "analysing" animation. Demo mode is visibly labelled "Demo" in the UI and on the report.

**Demo mode** is a per-device switch for the parent (`/settings`, or `?demo=1` / `?demo=0` on any parent page), with the profile to replay: `elevated` by default, or `typical` / `noisy` (OPEN_QUESTIONS #13). On the Part 2 intro it replaces the camera step with "Play the demo games" (`/screening/{id}/activities/demo`): for the calibration and each task the browser fetches `GET /demo/screening-tasks/{task}?profile=` and posts it unchanged to the normal upload endpoint (joint attention replays the on-screen variant), then calls finalize. Those uploads carry `demo: true`; one is enough to mark the whole screening `is_demo`, which the result, both reports, the share page and the home card show. Demo replays report `mean_luma` 128 (48 for `noisy`) and the room's background noise.

The sessions are built in memory by `app/seed/screening_fixtures.py` (`fixture(profile, task)`, deterministic); `cd apps/api && uv run python -m scripts.make_fixtures` writes them as JSON task payloads to `apps/api/fixtures/screening/` (git-ignored, ≈ 4 MB). Tasks: `calibration`, `rtn`, `joint_attention` (on-screen), `joint_attention_live`, `imitation`, `gaze_preference`, `free_play`.
- `typical`: responds to name in 0.9–1.7 s, follows 5 of 6 points, copies all 4 actions, watches the children, no repeated movement.
- `elevated`: one late response (≈ 3.4 s) of 3, follows 1 of 6 (1 of 4 live), copies 1 action and attempts 2, prefers the geometric side, 2 hand-flapping episodes and 1 rocking episode.
- `noisy`: a typical child in low light with a fan running: bursty face and pose loss, double landmark jitter, dropped frames, a call drowned by the fan, and one trial where the child never looked away. Calibration falls back; tasks come out `low` or `inconclusive`.

## 10. API (screening)

```
POST   /api/v1/children                         create child (screening status)
POST   /api/v1/screenings                       {child_id, locale, informant} → screening with the items for its age
GET    /api/v1/children/{id}/screenings         summaries with progress (answered / total)
DELETE /api/v1/screenings/{id}                  parent: deletes the screening and its answers
POST   /api/v1/screenings/{id}/consent          {version}
PUT    /api/v1/screenings/{id}/answers/{item}   {option, other_text?}
POST   /api/v1/screenings/{id}/answers/{item}/map-other   {other_text} → {status: suggested|unclear|unavailable, option, confidence, reason}
POST   /api/v1/screenings/{id}/questionnaire    {note?} → ends Part 1
POST   /api/v1/screenings/{id}/tasks/{task}     {frames, markers, audio_events, variant?, device?, quality?, demo?} → task status
POST   /api/v1/screenings/{id}/tasks/{task}/skip
POST   /api/v1/screenings/{id}/finalize         → the screening with its RiskResult
GET    /api/v1/screenings/{id}                  status + tasks + result
GET    /api/v1/screenings/{id}/report?audience=parent|clinician
GET    /api/v1/screenings/{id}/shares           parent: links with status, views, last viewed (never the token)
POST   /api/v1/screenings/{id}/shares           {expires_in_days: 1|7|30} → {id, token, expires_at, …}
DELETE /api/v1/shares/{share_id}                revoke (by id: the token is only shown once)
GET    /api/v1/share/{token}                    public: clinician report data + expires_at
GET    /api/v1/demo/screening-tasks/{task}?profile=typical|elevated|noisy   parent: a sample upload (§9)
POST   /api/v1/screenings/{id}/chat             streaming (SSE)
GET    /api/v1/specialists/nearby
```

Limit task payloads to 5 MB; reject otherwise (413 `payload_too_large`, checked on Content-Length before the body is read; 411 `length_required` without one).

Task uploads: `task` is `calibration` or a scored task. `variant` (`on_screen` by default, or `live`) is accepted only for joint attention and imitation, else 422 `invalid_variant`; there is no `calibration` field, because the API fits it from the calibration upload (§4.3). Frames, markers and audio events are sorted by `t` before they are stored. The calibration's status is `ok` / `fallback` (with the §4.3 reason, or `skipped`); a task's is its `TaskStatus` with the §4.9 reason. Uploading again replaces the task. `mean_luma` / `noise_db` come in `quality` and are stored with the task. Finalize needs Part 1 completed with no answer waiting for confirmation (409 `questionnaire_incomplete`); reports and share links need a finalized screening (409 `screening_not_finalized`). Public share errors: 404 `share_not_found`, 410 `share_revoked` / `share_expired`.

Reads need `read:screenings` (parent, clinical members; audited for members), everything else `write:screenings` (parent only), via the COMPANION_SPEC §3.2 permission table. Writes to a finalized screening get 409 `screening_finalized`.

## 11. Honest limitations (keep in reports' method note and pitch Q&A)

- Weights, thresholds and items are heuristic placeholders; no sensitivity/specificity claims.
- Calibration with Bangladeshi clinical data (Year 2 plan) is required before any real-world use.
- Before a pilot, consider licensing a validated instrument with an established Bangla version (check its licence terms for app use) and compare against it.
- Lighting, camera angle, child mood and phone quality strongly affect measurements — hence quality gating and confidence.
