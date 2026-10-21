# NailsSalon: Progress Log

Living record of where the build stands. **Update this at the end of every working session.**
The plan and design live in [ARCHITECTURE.md](ARCHITECTURE.md). The hackathon brief and strategy live in Notion (Apptupia → "YouCam Hackathon Brief").

## Current status

- **Day:** 2 of 12 done (Oct 21, 2026, a day early). Next: **Day 3, `DesignSpec` + `toNailVtoPayload` + render route**.
- **Deadline:** submit by **Nov 1, 2026**. The official deadline is Nov 2, 11:45 am ET (4:45 pm Casablanca).
- **Live:** https://nailssalon-five.vercel.app, which auto-deploys from `main`. Health check at `/api/health`. Hand Quality Gate at `/hand`.
- **Repo:** https://github.com/laafou98/nailssalon (public, MIT)
- **YouCam units used:** 2 of 1,000 (smoke test on Oct 20).

## Build plan tracker

| Day | Date | Deliverable | Status |
|---|---|---|---|
| 1 | Oct 20–21 | Scaffold, Supabase schema + RLS, YouCam client, deploy | ✅ Done |
| 2 | Oct 22 | [A] Hand Quality Gate with live guidance | ✅ Done (Oct 21) |
| 3 | Oct 23 | `DesignSpec` + `toNailVtoPayload` + render route + cache + unit ledger | ⏭ Next |
| 4 | Oct 24 | [B] Landmark crops on inspiration photos, colour clustering | |
| 5 | Oct 25 | [C] DeepSeek semantics + design PNGs; [D] router with Transfer fallback | |
| 6 | Oct 26 | Spec editor UI, before/after compare | |
| 7 | Oct 27 | [E] Skin tone, undertone, polish matching, quote; salon catalogue | |
| 8 | Oct 28 | Recipe card + share page + WhatsApp hand-off | |
| 9 | Oct 29 | [F] Fidelity scorer; i18n (FR, AR + RTL) | |
| 10 | Oct 30 | Real-photo testing, failure states, polish | |
| 11 | Oct 31 | Demo video, screenshots, README, Devpost text | |
| 12 | Nov 1 | Buffer, final QA, **submit** | |

Cut order if behind: fidelity scorer → Arabic/RTL → press-on shapes → salon admin UI (seed instead).

## Session log

### Session 1, Oct 20, 2026
**Strategy**
- Researched the hackathon, Round 1 winners (Jul–Aug 2026) and competitors, and scored alternative ideas. Decided on **NailsSalon reframed** as a nail *design compiler* for salons, not a plain try-on app. The full rationale is in the Notion brief.
- Key evidence:
  - YouCam Nails and YouCam's Nail Transfer API already do "Pinterest onto my hand".
  - NailMock sells try-on, a salon brief and booking.
  - Chairside (hair salon booking) is already in this round.
  - Round 1 winners rewarded measurable problems, colour science, honesty about limits and B2B or inclusion angles.

**API validation:** `scripts/smoke-test.mjs`
- Nail VTO (exact `#B0123A` cream) and Nail Transfer both work: 7.2 s and 9.8 s.
- Result URLs expire after 2 h, so we must copy them into our own storage.
- Nail Transfer **places designs on the wrong fingers and loses fine detail** (the heart became a blob, the plaid lost its lines). This is our demo contrast: the spec compiler keeps each design on its finger.

**Built (Day 1)**
- Next.js 16.4 (App Router, TS, Tailwind 4, Cache Components on), moved into the repo root.
- Supabase project `nailssalon` (ref `cgfneztejdpqkfflonzj`, eu-west-3, free plan):
  - Migrations `0001_init.sql` (all tables, `reserve_units()`, RLS, private `images` bucket) and `0002_fk_indexes.sql`, both applied.
  - Advisors: only the expected INFO notes are left (server-only tables with no policies).
- `src/lib/env.ts`: validated server env, read per key.
- `src/lib/youcam/client.ts`: create, poll and timeout for `nail_vto` and `nail_transfer`. 6 Vitest tests.
- `src/lib/supabase/admin.ts`: service-role client (server only).
- `src/app/api/health/route.ts`: DB and key check, no unit spend.
- README with setup steps, MIT LICENSE, `.env.example`.
- Vercel: the user imported the repo through the dashboard (the Vercel MCP gets a 403 when creating projects). The env vars are set, and `/api/health` returns healthy on production.

**Decisions**
- Vision model: **DeepSeek V4.1 Flash** (`deepseek-flash`, OpenAI-compatible, supports image input). The user can't pay for another key.
- Skin tone comes from the hand photo itself (0 units), not the Facial Color Tones API (20 units).
- Booking system dropped; a WhatsApp recipe card replaces it.
- Repo commits use the `laafou98` GitHub noreply identity, set in the repo-local git config.

**Open items / blockers**
- DeepSeek is **blocked on the user's network** (corporate Zscaler). Test design extraction through the Vercel deployment, not locally. Do not try to bypass the block.
- Need from the user: a photo of the back of their own hand with bare nails, plus a messy real Pinterest screenshot, for real-world testing. Drop both into the project folder (`test-output/` is git-ignored).
- Confirm the exact DeepSeek model ID and image request format with a real call from Vercel (Day 4–5).

**Next step:** Day 2, the Hand Quality Gate.

### Session 2, Oct 21, 2026
**Built (Day 2): Hand Quality Gate [A]** at `/hand` (0 YouCam units)
- `src/lib/hand-gate/checks.ts`: pure checks on MediaPipe landmarks, each pass / warn / fail with plain-language guidance, plus one headline ranked by what to fix first. Checks: exactly one hand, back of hand facing the camera, all 5 fingertips in frame, enough pixels on the hand, hand fills the photo, fingers apart, exposure, sharpness. 14 tests.
- `src/lib/hand-gate/pixels.ts`: luma mean + clipped highlights, variance-of-Laplacian sharpness on the nail region. 2 tests.
- `src/lib/hand-gate/browser.ts`: lazy-loads MediaPipe HandLandmarker (GPU, falls back to CPU), samples pixels, and normalises the photo: crops around the hand to 1:1 / 3:4 / 4:3, long side ≤ 2048, JPEG, landmarks re-mapped to the crop.
- `src/components/hand-gate/HandGate.tsx`: camera (rear camera on phones) with live landmark overlay and headline, auto-capture after 1.5 s of all-green, manual "Take photo", or upload. Re-checks the still frame before accepting it.
- MediaPipe is self-hosted: WASM copied from `node_modules` by `scripts/copy-mediapipe.mjs` (runs on `predev` / `prebuild`, git-ignored); model `public/mediapipe/hand_landmarker.task` (7.8 MB, float16 v1) is committed.

**YouCam's real input rules** (from docs.perfectcorp.com/reference/ai_nail_vto): one hand, back of hand, nails unoccluded, palm ideally ≥ half the image area, long side ≤ 2048, short side ≥ 256, aspect ideally 1:1, 3:4 or 4:3, ≤ 10 MB jpg/png. Image errors: `error_nail_too_small`, `error_no_nail`.

**Verified in the browser** with `test-output/` photos: back of hand passes (as a left hand, mirrored to a right hand, and rotated 90°); inspiration close-up, two hands, too small and blurred (3 px) are rejected with the right message; 1.5 px blur only warns. The live loop was tested with a fake camera stream (the browser pane blocks real cameras): it auto-captured a 713×950 crop.

**Findings**
- MediaPipe's docs say handedness assumes a mirrored image, but on our un-mirrored photo of a left hand it answered "Left" (0.96). We treat the label as the real hand (`anatomicalHand`). The palm-side check is **not yet tested on a real palm photo**: a left hand's back and a right hand's palm have the same outline, so it depends on the model reading skin texture. If it can't, palms slip through (YouCam would then return `error_no_nail`); backs are never wrongly blocked.
- MediaPipe loses the hand on this low-contrast studio photo at about 0.55× or 1.3× brightness, before our exposure thresholds trip. When no hand is found we now measure the whole frame and say "Too dark / too bright to find your hand" instead.

**Open items**
- Test on a real phone: rear camera, lighting, palm rejection. Tune sharpness thresholds (20 fail / 60 warn) on real camera frames.
- Still need from the user: own bare-nail hand photo and a messy Pinterest screenshot (see Session 1).

**Next step:** Day 3, `DesignSpec` types, `toNailVtoPayload` (pure, tested against the documented schema), `POST /api/renders` with cache key and unit ledger. Upload the gated hand photo to Supabase Storage as part of it.

**Phone test + fix (same day)**
- The user tested on their phone. It works, but an almost edge-on hand (turned ≈ 67°) was auto-captured: the back/palm check only *warned* because MediaPipe was unsure, and warnings didn't block capture.
- New **pose check** (`handPose` in `checks.ts`): how far the hand is turned about its long axis, from 2D foreshortening of the knuckle line (knuckle width / palm length; 0.70 flat in live video, 0.28 on the user's photo). MediaPipe's 3D world landmarks were useless for this: they called the edge-on hand flat. The per-landmark depth (z) does get the near side right, so it gives the direction ("bring your little finger / thumb towards the camera").
- Thresholds: ≤ 30° pass, 30–45° warn (manual photo only), > 45° fail. New `report.autoCapture`: the camera only takes the photo by itself when the pose passes.
- **Live 3D guide** (`TiltGuide.tsx`): a small hand card that rotates in 3D with the user's hand (CSS perspective) over a flat dashed target, with a curved arrow for which edge to swing forward; it turns green at "Flat ✓". The palm area on the overlay is tinted pink / amber / green and narrows as the hand turns.
- UX: the checklist is hidden while the camera is live (headline + guide are enough) and shown on the result; the camera view is capped at 70% of screen height so a portrait phone camera fits with the buttons.
- Verified in the browser at phone size with a fake camera (user's edge-on photo → blocked with direction; flat photo → green → auto-captured) and by uploading the edge-on photo (rejected). 25 tests pass.
- Still to check on a real phone: the guide's rotation direction with the rear camera, and palm rejection.
