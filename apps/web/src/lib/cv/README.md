# lib/cv — browser capture and per-frame features

SCREENING_SPEC §4.1. The browser turns camera and microphone input into numbers; the API
(`apps/api/app/scoring/`) does all event detection and scoring.

| File          | What it does                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `features.ts` | Pure maths: head angles, `nose_dx`, iris offsets, `iod`, the pose record, child-face pick, luma, RMS. No imports.                                            |
| `realtime.ts` | The only live decisions: the name-game "look away" gate and whether Copy me repeats an action.                                                               |
| `models.ts`   | Lazy MediaPipe loading. GPU delegate with a CPU fallback. Each model is created once per page load.                                                          |
| `audio.ts`    | AudioWorklet tap: RMS of every 50-ms block, and YAMNet on contiguous 1-s windows.                                                                            |
| `capture.ts`  | `CaptureSession` (camera + mic, the ~15 fps loop, camera switching) and `TaskRecorder` (one task's frames, markers and audio events in memory until upload). |
| `cv.test.ts`  | `pnpm test:cv`: Node's test runner on the pure modules.                                                                                                      |

## Privacy

- Frames are read from an in-memory `<video>` and passed straight to MediaPipe.
- Audio blocks live only in the worklet's buffers and a 1-s window.
- Nothing is recorded, stored or uploaded except the numeric `TaskUpload` (`frames`, `markers`, `audio_events`, `device`, `quality`).
- The camera stays on only inside `/screening/[id]/activities/*`. The `CaptureProvider` there stops every track when the parent leaves or reaches "analysing".

## Models and WASM

- **Everything is self-hosted** under `public/models/<key>/` (git-ignored). `<key>` (e.g. `mp-v1.1.1-a1.1.1`) carries both MediaPipe package versions, so the files are served with a one-year `immutable` cache header and an upgrade simply gets new URLs. The list lives in `scripts/mediapipe-assets.mjs`.
- `scripts/prepare-models.mjs` runs before `pnpm dev` / `pnpm build`:
  - **WASM:** copies `*_wasm_internal` and `*_wasm_nosimd_internal` from `node_modules`, so the JS and WASM versions always match. The unused `_module_` variants are skipped.
  - **Models** (`face_landmarker`, `pose_landmarker_lite`, `yamnet`): downloaded once from Google's model storage and checked against pinned SHA-256 hashes. A file already present with the right hash is kept.
- **Service worker:** caches `/models/*` cache-first (`src/sw/sw.ts`).
- **Prefetch:** `prefetch.ts` downloads the SIMD set one file at a time while the parent is on the questionnaire (skipped for demo screenings and with Save-Data on), so the games start without a wait.
- **Face landmarker:** `numFaces: 2`, with blendshapes and transformation matrices.
- **Pose landmarker:** `numPoses: 2`. The child's body is the one nearest the child's face, else the narrowest.
- Pose runs only during Copy me and Free play.
- MediaPipe's WASM prints routine `INFO:` lines on stderr. `models.ts` sends only those to `console.info`, so they don't show up as errors.

## Coordinate conventions

- **Image coordinates are as captured (un-mirrored):** x to the right, y down, 0–1.
  - The front-camera preview is mirrored with CSS for the parent, but features are always computed on the un-mirrored frame.
  - Face boxes drawn on a mirrored preview are flipped (`cam-feed.tsx`).
  - In live pointing, a tap on a mirrored preview is converted to the image side.
- **`yaw` (degrees)** comes from the facial transformation matrix, a column-major 4×4.
  - The face's forward direction is its third column `(m8, m9, m10)`.
  - `yaw = −atan2(m8, m10)`. Camera space has x toward image right, so a nose turned toward image left gives `m8 < 0` and `yaw > 0`. That is "turned toward the child's own right" (§4.1).
- **`pitch`** is `atan2(m9, √(m8² + m10²))`, positive when the face points up. The scorer only uses `|pitch|`.
- **`nose_dx`** = (nose tip x − midpoint of cheek points 234/454) / inter-ocular distance, in pixels.
  - It is negative when the nose is toward image left.
  - Measured scale: about −0.04 per degree of yaw. That is steeper than the fixtures' synthetic −0.012/°, because the far cheek contour moves the other way.
  - The scorer uses `nose_dx` only for its sign and for comparisons, never its size.
- **`iris_x` / `iris_y`** are the mean iris-centre offset from each eye's corner midpoint, over half the eye width (both axes, because the eye height collapses in a blink), clamped to −1…1. `iris_x > 0` means toward image right.
- **`iod`** = distance between the two eye-corner midpoints / frame width.
- **Pose:** `[x, y × height / width, visibility]`. `l_*` is the child's own left (MediaPipe's convention), which is image right on an un-mirrored frame of a child facing the camera.

## How the yaw vs `nose_dx` sign was verified (2026-10-17)

1. **Unit test (`cv.test.ts`).** Rotation matrices about the camera's y axis give the expected `yaw` sign, and a synthetic mesh with the nose moved toward image left gives `nose_dx < 0`.
2. **Real models, real pipeline.**
   - Headless Chrome ran the setup check (`?cvdebug=1` shows the live numbers).
   - The fake camera (`--use-file-for-fake-video-capture`) was a clip of MediaPipe's public test portrait (`mediapipe-assets/portrait.jpg`) in four views: original, mirrored, and two synthetic turns (one half of the face squeezed to 60%).
   - In every view the signs were opposite, as §4.1 requires:

     | view      | yaw   | nose_dx |
     | --------- | ----- | ------- |
     | portrait  | 8.0°  | −0.378  |
     | mirrored  | −9.5° | +0.401  |
     | squeeze A | −2.1° | +0.052  |
     | squeeze B | 1.1°  | −0.030  |

   - Mirroring flipped both.
   - The GPU delegate loaded in headless Chrome.

   No photo was kept in the repo.

3. **To re-check on a device:** open `/screening/<id>/activities/setup?cvdebug=1`, face the camera, then turn your head toward your own right. `yaw` should rise above 0 and `nose_dx` fall below 0.

This hasn't yet been re-checked with a real person turning in front of a webcam or a phone camera (see docs/CHANGELOG.md, B6).
