# NailsSalon: Progress Log

Living record of where the build stands. **Update this at the end of every working session.**
The plan and design live in [ARCHITECTURE.md](ARCHITECTURE.md). The hackathon brief and strategy live in Notion (Apptupia → "YouCam Hackathon Brief").

## Current status

- **Day:** 6 of 12 (Oct 25, 2026). Pushed: everything through the true-colour composite (session 9). Committed, **not yet pushed**: design cut-out cleanup (glare removal, body-only art, partial-nail and blur checks, touching-nail split; session 10). **Next:** push; phone test of an extension render from an art inspiration (≈ 1 unit), then Day 7 (skin tone, polish matching, quote).
- **Deadline:** submit by **Nov 1, 2026**. The official deadline is Nov 2, 11:45 am ET (4:45 pm Casablanca).
- **Live:** https://nailssalon-five.vercel.app, which auto-deploys from `main`. Health check at `/api/health`. The whole flow so far is on `/hand`: hand photo (quality gate) → try-on with one colour, or tap-to-pick from an inspiration photo.
- **Repo:** https://github.com/laafou98/nailssalon (public, MIT)
- **YouCam units used:** about 6 of 1,000 (smoke test Oct 20 + the user's phone renders Oct 21; `/api/health` shows the ledger total).

**Open items and parked decisions** (keep this list current; details in the session log)
- **Vision model** (Oct 24): switched from DeepSeek to **Claude** (`claude-opus-5-5`, effort `low`, structured outputs). Not yet run for real: needs the user's `ANTHROPIC_API_KEY` in `.env.local` and on Vercel. `DEEPSEEK_API_KEY` can be removed from Vercel.
- **Router threshold** (Oct 23): Transfer below spec confidence 0.6 (pick confidence averaged with the model's). Tune once real readings come in; maybe too eager with unsure outlines.
- **Curled-fingers hand pose** (Oct 22): now accepted by the gate (palm side + fingertips folded near their knuckles). Rule set from geometry; confirm live on the phone (free), then one real render to see if YouCam handles it.
- **Nail outlining** (Oct 22, Oct 24): the colour flood failed on the user's brown-on-brown photo (1 of 5 right). SlimSAM fixed the outlines but crashed iPhone Safari; **MobileSAM** (Oct 24) outlines all 5 on that photo (now `test-output/inspo/inspo-8.jpg`), in iOS Simulator Safari too. The picker now says which outliner produced each outline. Still weak: diagonal nails (the box prompt is axis-aligned), marble/smoke art (SAM follows the pattern), half-hidden thumbs as the first pick (they set the "typical" size). **Phone-confirmed (Oct 24, 16:57 Casablanca):** no crash, "Outlines by MobileSAM", 5/5 on the brown photo (ring outline slightly over the cuticle side), finishes read (Jelly on the swirl nails, Cream elsewhere).
- **Extensions look fake** (Oct 25, user): the cut-outs carried the photo's glare, ragged base-colour fringes, a side-on thumb sliver and a two-nail pinky. Cleanup built (session 10); YouCam still lays press-ons on as flat stickers (hard edge, no contact shadow): a realism pass on every render is the next candidate. Not yet seen on the phone.
- **Real renders of both length modes** (Day 5): "Keep my length" with the short-nail crop, and "Extensions" (press-on: never rendered for real yet). Check what YouCam's `length` 1.0–2.15 actually looks like and adjust the Short/Medium/Long/Extra long steps.
- **Product decision (user, Oct 22):** natural length is a feature, not a bug. Keep both modes; "Extensions" is a different salon service and price (feeds the Day 7 quote and the recipe card).
- **Phone test of tap-to-pick** (Day 4): colours worked on the user's phone (Oct 22); the art wasn't copied, which led to design PNGs.
- **Render realism** (Oct 25): the true-colour composite is built in (`src/lib/render/composite.ts`) for plain-colour Nail VTO renders: exact hue per finger, photo grain. Checked offline on the 5 plain-colour phone renders (coral chrome now coral; dark greens match per finger). Not applied to design fingers or Transfer. Chrome streaks are softened, not gone: maybe tone down the metallic preset on Day 7. YouCam's original is kept next to it as `renders/<id>-youcam.<ext>`. Not yet seen on the phone.
- **Camera:** confirm on the phone whether the accepted photo says "camera photo" (full-res ImageCapture) or "video frame".
- **Known limits:** tap-to-pick tuned on 3 photos only (half-hidden thumbs can leak into look-alike backgrounds; chrome outlines aren't accents). Side-on thumbs still get painted by YouCam.
- **Tooling:** the Vercel MCP returns 403 for deployments and runtime logs. Check deploys with `gh api repos/laafou98/nailssalon/commits/<sha>/status`; debug server errors by reproducing locally (`dev-live` launch config).
- **Dev quirk:** React dev mode runs the hand-upload effect twice (two sessions per local test). Clean up test sessions, rows and storage objects after local tests; never delete the user's phone sessions or rows that carry real units.
- **Not urgent:** a visible display/lag polish for the rendered image (user: "fix later"); UI/UX polish deferred, the user wants functionality first.

## Build plan tracker

| Day | Date | Deliverable | Status |
|---|---|---|---|
| 1 | Oct 20–21 | Scaffold, Supabase schema + RLS, YouCam client, deploy | ✅ Done |
| 2 | Oct 22 | [A] Hand Quality Gate with live guidance | ✅ Done (Oct 21) |
| 3 | Oct 23 | `DesignSpec` + `toNailVtoPayload` + render route + cache + unit ledger | ✅ Done (Oct 21) |
| 4 | Oct 24 | [B] Tap-to-pick nail crops on inspiration photos (was: landmark crops), colour clustering | ✅ Done (Oct 21) |
| 5 | Oct 25 | [C] Claude semantics + design PNGs; [D] router with Transfer fallback; MobileSAM outlines; automatic nail detection | ✅ Done (Oct 24–25); Transfer render still to confirm on the phone |
| 6 | Oct 26 | Spec editor UI, before/after compare | ✅ Done (Oct 25): per-finger colour and finish, apply to all, compare slider |
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
- Phone test 2: **palm rejection works** (headline "Turn your hand over", photo blocked), but the 3D card showed "Flat ✓" because it only reflected the turn angle. Fixed: `HandPose.facing` (back / palm / unsure) and the card now has a palm reverse face (pink, creases, no nails) that it flips to, with a circular "flip it" arrow; the dashed target swaps thumb side to match the turned-over hand. Checked visually on a temporary page (a screenshot of the phone screen couldn't be re-detected: baked-in overlay lines and a dark scene).
- Still to check on a real phone: the card's rotation direction with the rear camera, and the new palm flip.

### Session 2 (cont.), Oct 21, 2026: Day 3, render pipeline
**Built**
- `src/lib/spec/types.ts`: `DesignSpec` zod schema (per-finger kind / colour / texture / pattern / design image; press-on shape + length), `solidSpec()`.
- `src/lib/spec/payload.ts`: `toNailVtoPayload` (pure). One parameter preset per finish, only the parameters YouCam allows for each (no transparency on metallic, shimmer only on pearl/shimmer, textured size only on textured); press-on maps the 9 finishes onto YouCam's 3. `renderCacheKey` = sha256 of the exact payload with signed URLs swapped for content identities, so confidence/polish-match edits never cost a unit. 9 tests.
- `POST /api/hands`: stores the gated photo (re-validated server-side: real JPEG, size read from the SOF marker must match, 256–2048 px, 21 landmarks, ≤ 4 MB). Content-addressed path `hands/<sha256>.jpg`; anonymous session via httpOnly cookie `ns_sid` (`src/lib/session.ts`). 4 tests.
- `POST /api/renders` + `GET /api/renders/:id` (`src/lib/render/service.ts`): cache hit → result with no unit; else claim the cache key (unique insert stops double-spends), reserve a unit, create the YouCam task with 1 h signed URLs; polling copies the result to `renders/<id>.jpg` straight away. A failed or timed-out (2 min) render is refunded exactly once.
- Migration `0003_render_units.sql` (applied): `reserve_units` now records the render id, new `refund_units(render_id)`, unique `(session_id, kind, sha256)` on images. Advisors: only the expected INFO notes.
- `/hand` is now photo → try-on: 6 swatches + colour picker, 5 finishes, "Try it on", hold-to-compare, friendly errors.
- `YOUCAM_MOCK=1` (local only, never in production) for free end-to-end tests.

**Verified locally with the mock against the real Supabase:** upload → render (≈ 9 s) → result copied to storage → identical request served from cache; forced failure (`#000001`) showed "couldn't find your nails" and refunded the unit; `reserve_units` refuses at the session cap. Test rows and storage objects were deleted afterwards. **No real YouCam units spent** (still 2 of 1,000).

**Open items**
- First real render on the deployed app, from the user's phone (1 unit): confirms signed Supabase URLs work as `src_file_url` and the finish presets look right.
- React dev mode double-runs the upload effect (two sessions in dev only). Harmless; revisit if it shows up in production.

**First real render (user's phone, Oct 21, 1 unit; total now 3 of 1,000)**
- YouCam accepted our signed Supabase URL and rendered in seconds, but our poll crashed copying the result: YouCam's result is a **PNG served by S3 as `binary/octet-stream`**, and the private bucket only accepts image types. The route rethrew, so the phone got an empty 500 ("Unexpected end of JSON input").
- Fixes: detect the image type from magic bytes (`src/lib/render/image-type.ts`, 2 tests); check YouCam *before* the 2-minute timeout so a finished-but-uncollected render isn't thrown away (it has already cost a unit); every route returns JSON errors and logs unexpected ones (`src/lib/api.ts`); the client copes with non-JSON replies.
- The paid render was recovered locally with the fixed code (`dev-live` launch config, polling is free) and saved as `renders/<id>.png`. Chrome on coral `#F0645A` came out closer to red, with strong streaks: tune the metallic preset during colour matching (Day 7). The side-on thumb was still painted.
- Vercel runtime logs aren't readable through the MCP (403), like deployments.

**Render quality (user feedback after the 2nd real render: "looks cheap", nails brighter than the hand, camera looks low-res)**
- Camera: the photo was a frame from the video preview (low-res, heavily compressed on phones). Now the capture uses `ImageCapture.takePhoto()` (full-resolution still, flash forced off) where supported (Chrome/Android), falling back to the video frame (iOS). The result line shows which was used ("from a 4000×3000 camera photo").
- Render look, prototyped offline on both real renders + the studio smoke test (`scripts/prototypes/true_colour_composite.py`, comparison in `test-output/true-colour-comparison.png`): the cheap look = Chrome's built-in streaks and **hue drift (coral #F0645A came back as saturated red)** + a crisp, noise-free nail on a dim, noisy photo. A "true-colour composite" (YouCam's mask + shading, exact requested hue in OKLab, cleaned mask edges, the photo's grain) fixes hue and the too-clean look and leaves good renders unchanged. Estimating scene brightness/saturation (to make nails sit darker in a dim room) was unreliable on these samples, so it's disabled. Not built into the app yet: decision pending with the user.
- Units: 4 of 1,000 (the user's 2nd render).

**Next step:** Day 4, landmark-guided nail crops on inspiration photos ([B]) and OKLab colour clustering.

### Session 2 (cont.), Oct 21, 2026: Day 4 started
**Camera test:** the user tested the full-resolution capture and a Cream render on their phone: "cream looks decent". (Whether the result line said "camera photo" or "video frame" wasn't reported; check next time.)

**Inspiration test images** (from the user, git-ignored): `test-output/inspo/inspo-5.jpg` (two overlapping hands, nude French + white bows + tiny rhinestones), `inspo-6.jpg` (two interlaced hands, long almond burgundy ombré with chrome outlines), `inspo-7.jpg` (one curled hand, dark green with white swirls + one cream accent nail with green lines).

**Finding: MediaPipe cannot read inspiration photos.** With default settings it finds no hand in any of the three. With `minHandDetectionConfidence` 0.1, 60% grey padding and 0/90/180/270° rotations it "detects" hands with scores up to 0.99, but drawn back on the images the landmarks are nonsense (a tiny hand on the ribbon bow, a hand squeezed onto one nail). Close-up, curled, overlapping nail-art shots are outside its training. Landmark-guided crops ([B] in ARCHITECTURE.md) are dropped for inspiration photos (the client's own hand photo still uses MediaPipe).

**Decision (user, Oct 21): tap-to-pick.** The user taps the nails on the inspiration image in finger order (thumb → pinky; allow skipping or reusing a nail for fingers not visible). For each tap we auto-outline the nail around the tap and extract its colours. Works on any image (curled hands, product shots) and keeps each design on its finger. Later the vision model (Day 5) can pre-place the taps.

**Next step:** build tap-to-pick: nail outline from a tap (region growing in OKLab from the tap point, bounded by colour distance/edges and a max size, cleaned with morphology), oriented crop, skin/background removal, OKLab k-means (k = 2–3) → `baseHex` + `accentHexes` per finger, a draft `DesignSpec` (texture cream by default; pattern/finish from the vision model on Day 5), and UI on `/hand`: upload an inspiration image, tap 5 nails, see swatches per finger, "Try this on my hand" through the existing render pipeline. Pure functions unit-tested (synthetic pixel buffers), verified on the three test images in the browser (`dev-mock` launch config renders for free).

### Session 2 (cont.), Oct 21, 2026: Day 4, tap-to-pick
**Built** (all in the browser, 0 YouCam units)
- `src/lib/inspo/oklab.ts`: sRGB ↔ OKLab, hex helpers, whole images as OKLab channel planes.
- `src/lib/inspo/region.ts`: the nail outline from one tap. The photo is shrunk to a 512 px long side, painted lines are filtered out (grey-level opening + closing, so a swirl doesn't cut a nail in two) and lightness counts half as much as hue (gloss changes a nail's lightness a lot; what separates a dark green nail from a dark green sweater, or a nude nail from skin, is mostly hue). A flood spreads from the tap in order of "path cost" (colour steps, plus a penalty for straying from the tapped colour). At each size we know how strong the edge under the region's border is; among the sizes where it peaks, we keep the one that is strong *and* nail-shaped (convex, fills its box like an ellipse, not a sliver). Then holes are filled, thin leaks cut, a touching white French tip merged, and a principal-axis box measured.
- `src/lib/inspo/colours.ts`: k-means (k = 4, deterministic start) on the outlined pixels at 2× resolution, skipping glare and border pixels that match the surround (skin caught by the outline). Shading of one polish is merged (lightness at a quarter weight); specks under 5% dropped. Base = largest cluster at its 70th-percentile lightness (curved glossy nails are mostly in shadow); accents = the purest 30% of each other cluster (thin lines blend into the base). Plus a separation score.
- `src/lib/inspo/pick.ts`: `pickNail` (outline + colours + confidence from shape, size, edge and colour separation), `draftSpec` (taps → `DesignSpec`: `kind: "color"`, cream, solid; skipped fingers copy the nearest picked finger, ties to the thumb side, confidence ≤ 0.3). Nails in one photo are alike, so an outline more than twice the median size is redone with that cap.
- `src/lib/inspo/browser.ts` + `src/components/try-on/InspoPicker.tsx`: on `/hand`, after the hand photo, a "One colour / Use an inspiration photo" switch. Upload, "Tap your thumb nail" → index → …, outlines drawn with finger labels, a row of 5 swatches (base + accent dots, "copied"/"unsure" labels), Skip / Undo / Redo, "Try this on my hand" → the existing `POST /api/renders`.
- 22 new tests on synthetic images (plain nail, thin line across it, French tip, dark nail on a look-alike background, size cap, colours with lines/gloss/glare/skin edge, draft spec skipping). 61 tests total.

**Verified** in the Browser pane (phone size, `dev-mock`, the user's 3 photos, taps injected by script):
- inspo-7: index/middle/pinky dark green (#1A2D21 – #16271C) + pale line accent; ring cream #E2D7C9 + green accent #576E51. Mock render succeeded with all 5 per-finger colours in the request.
- inspo-5: nude bases (#C3–#D1 pinks) + near-white tip accents, tips merged into the outlines. Undo/redo work.
- inspo-6: burgundy bases with pale/chrome-grey accents; skipping the middle finger copied the index ("copied").
- Picking takes about 1.5 s to open a photo and well under 0.1 s per tap on the laptop.
- Test sessions, rows and storage objects were deleted afterwards (the user's own phone session was left alone).

**Known limits**
- inspo-7's half-hidden thumb (a sliver against a lit sweater of almost the same green) still leaks into the sweater; its colour is still green.
- inspo-6: tapping inside a chrome loop outlines the area inside the loop, not the whole nail, and the chrome itself isn't an accent. Fine for the base colour; the vision model (Day 5) should name chrome/ombré.
- Thresholds were tuned on these 3 photos only. Real phone test needed.

**First real per-finger render (1 unit, total about 6 of 1,000):** inspo-7 picked locally (`dev-live`) and rendered on the studio hand photo. YouCam put each colour on the right finger: cream on the ring nail, dark green on the others (lighter green thumb). Its rows are kept so the unit ledger stays accurate; only the duplicate dev-mode session was deleted. Pushed to `main` (deploys to Vercel).

**Next step:** user tests tap-to-pick on their phone. Then Day 5: DeepSeek semantics (texture, pattern, confidence per finger) via Vercel, and design PNGs for art nails.


### Session 3, Oct 22, 2026: Day 5 started, design PNGs
**Trigger:** the user tested tap-to-pick on their phone: colours came through, the nail art (moons, stars, leaves) didn't. As built on Day 4, every finger went to YouCam as a plain colour.

**YouCam's design-image rules** (docs.perfectcorp.com/reference/ai_nail_vto): PNG, width 271–542, height 522–1044, ≤ 1 MB, ≥ 72 ppi, "applied from the center". Transparency and orientation aren't specified for nail polish; YouCam's press-on sample is one upright nail filling the frame.

**Built** (0 YouCam units)
- `src/lib/inspo/design.ts`: `nailDesign` cuts one tapped nail out of the photo along its principal axis, tip at the top, reading from a full-resolution copy (≤ 3000 px long side) and blending the outline edge softly. Everything outside the outline (eroded by one working pixel) is filled with the nail's base colour, so skin or background never lands on the client's nail. `designSize` keeps proportions within YouCam's limits; `tipDirection`: the narrower end is the tip (almond/stiletto, when one end holds < 80% of the other's outline), else "fingers point up the photo". 8 tests.
- `src/lib/inspo/browser.ts`: `nailDesignPng` encodes the cut-out as a PNG, shrinking until it is under 1 MB.
- `POST /api/designs/images` + `src/lib/render/design-upload.ts`: validates a real PNG within the limits (size read from IHDR), stores it content-addressed at `designs/<sha256>.png` as a `design` image of the session. 3 tests.
- `src/lib/render/service.ts`: design image ids in a spec must belong to the session (checked **before** a unit is reserved).
- `pick.ts`: `withDesigns(spec, ids)` turns fingers into `kind: "design"`, `pattern: "art"`, keeping `baseHex` for polish matching. 1 test.
- Picker UI: each finger shows its cut-out; a "Design / Colour" switch per finger (default Design) and "Flip" when the tip guess is wrong. "Try this on my hand" uploads one PNG per picked nail (skipped fingers reuse their source's), then renders.

**Verified** with `dev-mock` at phone size on inspo-7 (thumb skipped): cut-outs show the white swirls and the cream nail's green lines; the tip rule points the right way on all four sideways nails (checked offline with sharp). 4 PNGs uploaded (271 × 581–773), render spec had all five fingers as `design` (thumb sharing index's image), mock render succeeded. Test rows (render, design, ledger row 9, 5 images) and storage objects were deleted; the user's phone session and the paid Day 4 render were left alone. 73 tests, typecheck, lint, build pass.

**Known limits**
- Inspiration nails are long; YouCam stretches the cut-out over the client's (shorter) nail, so art gets squashed. Cropping to the client's nail proportions is a possible fix after seeing a real render.
- Outline edges come from the 512 px working image: a thin dark rim of shadow can stay at the nail's edge.
- Plain nails also default to Design (shading baked in). DeepSeek (next) should pick Colour for plain nails.

**Next step:** user pushes and renders a design on their phone (1 unit). Then DeepSeek semantics via Vercel.

### Session 3 (cont.), Oct 22, 2026: own-hand warning, natural length vs extensions
**Phone test (1 unit, total ~7):** the design render worked ("works better now"). Two findings:
1. The inspiration picker showed the user's own earlier screenshot: iPhone's photo picker lists the latest photos/screenshots first, and they picked it as "inspiration" (the app keeps no photos).
2. Nail Polish VTO keeps the client's real nail length. The user likes that for short nails, but long inspiration art squashed onto short nails looks wrong. Decision: keep natural length as the default and add extensions as a choice.

**Built** (0 YouCam units)
- **Own-hand warning:** `showsWholeHand` (`hand-gate/checks.ts`, 1 test) + `looksLikeOwnHand` (`inspo/browser.ts`) run MediaPipe on the chosen inspiration photo; a whole hand with all five fingertips in frame shows an amber "This looks like a photo of your own hand…" note with "It's right" to dismiss. Real inspiration close-ups don't trigger the detector (Oct 21 finding). The upload button now says "Choose the nail design you want", with a hint.
- **Keep my length** (`design.ts`): `artWindow` keeps a 1.3 × width stretch of the nail (a short natural nail) where the art differs most from the base colour (48-bin profile, slight pull to the centre), so motifs stay whole instead of being squashed. `designSize` now widens short crops instead of stretching them to the 522 px minimum height (402 × 522 for 1.3).
- **Extensions:** effect `press_on_nails` with `shape` = `<tip>_oval` (YouCam's names are tip_cuticle, checked against nails.json thumbnails) and `length`. Cut-outs are the whole nail on a transparent background (YouCam's press-on rule). `guessExtensions` (pick.ts): taper at the outermost 10% of each end (< 0.45 stiletto, < 0.85 almond, else square if boxy, else oval) and length = nail aspect / 1.3 snapped to Short 1.0 / Medium 1.4 / Long 1.8 / Extra long 2.15. UI: "Keep my length / Extensions" switch, shape chips, length chips.
- Taper fix: measured over the outer 30% it averaged away (inspo-7 almonds read 0.80–0.90, guessed "oval"); over the outer 10% they read 0.57–0.81. The tip direction now comes from the taper on all four inspo-7 nails, not from the photo-up fallback.
- 11 new tests (84 total).

**Verified** (`dev-mock`, phone size): warning shown for the hand photo and for three app screenshots (including the user's two), not for inspo-5/6/7. inspo-7 guessed Almond + Long; Extensions render stored `press_on_nails`, `almond_oval`, 1.8 with whole-nail PNGs (271 × 581–773); Keep my length stored polish with 402 × 522 crops. Test rows and storage objects deleted (the user's session and the paid Day 4 render kept).

**Unknowns:** what YouCam's press-on `length` means visually (1.0 = natural?) and whether it honours our transparent cut-out's shape or its own `shape`. Needs one real Extensions render.

**Next step:** user tests both modes on the phone (2 units). Then DeepSeek semantics via Vercel (finish, pattern, plain vs art → Design/Colour default, shape/length cross-check).

### Session 3 (cont.), Oct 22, 2026: curled-hand pose, clean extension silhouettes
**Phone test (1 unit, total ~8):** the user's Extensions render (almond, Extra long 2.15, green glitter photo). Index/middle/ring cut-outs were good (glitter stripes visible); thumb (a dark blob) and pinky (a smudge) were bad outlines. **YouCam uses the press-on PNG's alpha as the nail shape**, so ragged outlines rendered as torn nails. Also: the gate refused the curled-fingers pose ("palm side"), which is how most nail photos are taken.

**Built** (0 units)
- `fingersCurled` (`checks.ts`): mean fingertip-to-knuckle length / palm length over index–pinky < 0.6 (straight fingers ≈ 0.95). A palm-side hand with curled fingers passes ("Fingers curled, nails facing the camera", `pose.facing = "curled"`); a flat palm is still refused with "Turn your hand over, or curl your fingers so your nails face the camera". MediaPipe found no hand in the user's screenshot (591 px, overlay drawn on it), so the threshold is from geometry only. 1 test.
- Extensions are drawn into a clean silhouette per tip shape (`silhouetteHalfWidth`: almond, stiletto, oval, square, squoval; rounded oval cuticle; 1.5 px anti-aliasing), filled with the cut-out (base colour where the outline missed). Changing the shape redraws the previews. 2 tests (86 total).

**Outline diagnosis** on a crop of the user's screenshot of the glitter photo: middle/ring/pinky outlines cover the nail centres but miss the pale mint rims; the half-hidden thumb is a few pixels. Colour-distance flooding can't separate pale glitter from pale skin and a white wall. See the SlimSAM proposal in open items.

### Session 4, Oct 23, 2026: DeepSeek design reading, render router
**DeepSeek key check:** Zscaler blocks api.deepseek.com from the Mac (block page returned), so the key and its model list are still unchecked; the user deferred it. Web research: `deepseek-flash` (V4.1 Flash) accepts images (base64 or URL, ≤ 384 tokens each); `deepseek-v4-pro` is text-only.

**Built (Day 5, [C] semantics + [D] router)**, 0 YouCam units
- `src/lib/vision/reading.ts` (pure, 9 tests): the chat request (system prompt with our texture/pattern/shape vocabularies; full photo + one crop per tapped finger; `response_format: json_object`), a lenient parser (unknown values drop that field, not the reading; fenced JSON accepted; length names → our 1.0/1.4/1.8/2.15 steps) and `applyReading` (each finger takes the finish/pattern of the nail it copies; confidence = mean of outline and model confidence). Colours never come from the model.
- `src/lib/vision/deepseek.ts`: the call (45 s timeout). `DEEPSEEK_MOCK=1` (local, non-production) returns a fixed reading; the `dev-mock` launch config now sets it.
- `POST /api/inspirations`: stores the inspiration photo (browser re-encodes to JPEG ≤ 1536 px) as `inspo/<sha256>.jpg`; the spec's `source.imageId`. `POST /api/designs/extract`: inspo id + `crop_<finger>` JPEGs (≤ 384 px, ≤ 300 KB) → reading.
- `src/lib/render/router.ts` (3 tests): `chooseEngine` → Nail Transfer when an inspiration spec with a stored photo has confidence < 0.6, else Nail VTO; explicit choice wins. The render service now handles both engines (Transfer payload `src_file_url` + `ref_file_url`, its own cache key from the two photo hashes, `engine` stored per render and returned to the browser). `POST /api/renders` takes optional `engine`.
- UI (`InspoPicker`, `TryOn`): after the fifth tap, "Reading the finish and pattern…", then the model's one-line summary and a finish label under each finger; Design/Colour defaults from the pattern; extension shape/length default to the model's answer (then the outline guess). Unsure specs say up front that Nail Transfer will be used. "Compare: let YouCam copy the whole photo (Nail Transfer)" runs Transfer on demand (works with no taps). Transfer results carry an amber "Approximate" note and "Render each finger exactly instead".
- 97 tests pass; typecheck and lint clean.

**Verified** (`dev-mock`, inspo-5): reading shown (ring = Shimmer + Design, others Cream + Colour), per-finger VTO render, Transfer render with the approximate note, and "Render each finger exactly" hit the cache of the first render. Bug found and fixed on the way: the Transfer button sent the spec without the design cut-outs, so the per-finger redo lost the art. Test rows (3 renders, 3 designs, 3 images, 3 ledger units) and 5 storage objects deleted.

**Next step:** push (ask first), then on the phone: one inspiration try-on (DeepSeek call, about 1 unit), one Compare (1 unit), then both length modes.


### Session 5, Oct 24, 2026: phone test of Day 5, reply parsing, finish picker
**Phone test (≈ 1 unit):** the user's curled-fingers hand (palm side, accepted by the gate) with a dark-brown almond inspiration photo. Problems: (1) bad outlines (see open items); (2) the render looked fake: skin in the crops (the index came out skin-coloured) and every finger stayed on Design, so the photo's glare was copied as white streaks; (3) "Couldn't read the finish", with no way to choose one. The user found the Vercel log: `The vision model did not answer with JSON`, so the call itself and the `deepseek-flash` ID work.

**Built** (0 units)
- `reading.ts`: `extractJson` drops `<think>` blocks and fences, then tries the whole reply and the outermost `{…}`; `max_tokens` 2000. `deepseek.ts`: empty replies and parse failures include `finish_reason` and the first 200 chars of the reply in the logged error. 2 new test cases (97 tests).
- `InspoPicker`: a **Finish** chip row (all 9 textures) below the per-finger list. Default is per nail as read (Cream if unread); tapping a chip puts that finish on every nail, tapping it again goes back. Each finger always shows its finish. When the reading fails, all fingers default to **Colour** (pattern unknown; a real finish looks more natural than copied pixels) and the message says to choose a finish below.
- Verified with `dev-mock` (inspo-5): the reading shows per-finger finishes, Jelly sets all five, and its hint offers going back. One test inspiration row and its storage object deleted; the user's phone session untouched.

### Session 5 (cont.), Oct 24, 2026: reading errors in the app, SlimSAM outlines
The user asked for all the earlier proposals before pushing.

**Built** (0 units)
- `POST /api/designs/extract`: a vision-model failure returns 502 with its reason (our messages, DeepSeek error bodies: no secrets); the picker shows it in small grey text under "Couldn't read the finish".
- **SlimSAM tap-to-segment.** `src/lib/inspo/sam.ts` (pure, tested): encoder input (1024 long side, ImageNet normalisation, zero padding), tap → prompt point, the decoder's 3×256² logits → working-resolution masks (bilinear), and `chooseSamMask`. `sam-browser.ts`: onnxruntime-web 1.30 (`onnxruntime-web/wasm`, proxy worker), lazy load, one encode per photo (started when the photo is chosen), one decode per tap. `regionFromMask` (`region.ts`): the tapped piece, radius-1 opening, holes filled, French tip merged, measured like flood regions. `pickNail` takes an optional SAM outline; confidence = mean of SAM IoU and `pickConfidence`. `InspoPicker`: taps wait for their outline ("Getting the nail outliner ready…" / "Outlining…"); flood fallback when SAM fails or finds nothing nail-sized.
- `scripts/copy-mediapipe.mjs` → `scripts/copy-wasm.mjs` (also copies `ort-wasm-simd-threaded.{mjs,wasm}` to git-ignored `public/ort/`). Model ONNX files committed under `public/models/slimsam/onnx/`. New `prod` launch config (`next start`).
- 103 tests pass (6 new); typecheck, lint and `next build` clean.

**Findings**
- SAM's three guesses come back largest first here (hand, nail, part), not smallest first; choosing by size limits + score handles either order.
- In proxy (worker) mode ORT **transfers** input buffers, so reused embeddings were detached after the first tap: later taps silently fell back to the flood, and a second photo's encode hung. Fixed by copying the embedding tensors per decode (2 × 4 MB, negligible).
- Node prototype (onnxruntime-node, scratchpad only): encode ≈ 0.6 s, decode ≈ 20 ms on the Mac.

**Verified** in `dev-mock` and the production build (`prod`): inspo-7 (green swirls) all five clean, inspo-5 (French) five with tips merged on index/middle, a second photo in the same page works, inspo-6 (chrome rims) clean in production. Three test inspiration rows and files deleted.

### Session 5 (cont.), Oct 24, 2026: curled palm-side hand not found
**Phone test:** the user's curled, palm-side hand over a lit green keyboard was refused with "Show the back of one hand to the camera", the message for **no hand found** (the pose rules never ran). Reproduced on a crop of the screenshot: MediaPipe's palm detector finds nothing at 0.5 or 0.3 on the full frame, but finds it on a tighter crop or at 0.15, with handedness 0.99.

**Fix** (`hand-gate/browser.ts`): still photos that return no hand are re-detected at `minHandDetectionConfidence` 0.15; presence stays at 0.5, so the landmark model still has to be sure. At 0.15 a hand-free crop of the same photo and a noise image still give no hand. The live camera keeps 0.5. Verified by uploading the crop in `dev-mock`: accepted and cropped to the hand. Test hand row and file deleted.

### Session 5 (cont.), Oct 24, 2026: SlimSAM crashed the phone, switched to MobileSAM
**Phone test:** choosing an inspiration photo and tapping made iPhone Safari show "A problem repeatedly occurred" and reload: the tab ran out of memory. Measured with onnxruntime-node: one SlimSAM encode peaks at **≈ 2 GB** (its global-attention blocks build 12 × 4096² matrices).

**Switched to MobileSAM** (TinyViT encoder, windowed attention only): ≈ 200 MB peak. ONNX from `Acly/MobileSAM` (MIT). Its encoder takes the 1024-px HWC image at 0–255 and normalises/pads itself; the decoder is the standard SAM export (point + padding point, `orig_im_size` = working size so masks come back at working resolution, 4 guesses). EdgeSAM was ruled out (S-Lab licence: non-commercial).
- Quantization (onnxruntime `quantize_dynamic`, scratchpad venv): the full int8 encoder (11.3 MB) made outlines leak onto skin and background on the French photo; quantizing **MatMuls only** (14.3 MB) matches fp32. Decoder MatMul/Gemm int8: 4.7 MB (the default op set crashed the quantizer).
- Node prototype results: inspo-5/6/7 outlines as good as or cleaner than SlimSAM; the edge-cut thumb on inspo-5 gets no nail-sized guess (flood fallback).
- `sam.ts` rewritten for the new IO (`samPixels` HWC, `samPrompt`, `samMasks` splits the decoder output); `sam-browser.ts` loads `public/models/mobilesam/{encoder,decoder}.onnx`. SlimSAM files removed. 104 tests; lint, typecheck, build clean. Verified in `dev-mock` (inspo-5, no errors). Test inspiration row deleted; the user's two new hand rows kept.
- **Not verifiable here:** iPhone memory. 200 MB is in the range phones handle (MediaPipe already runs alongside), but only the phone test will tell.

### Session 5 (cont.), Oct 24, 2026: design reading moved from DeepSeek to Claude
The user has an Anthropic API key and asked to switch.
- `src/lib/vision/claude.ts` replaces `deepseek.ts`: `@anthropic-ai/sdk` 1.3.0, `client.beta.messages.parse` with `claude-opus-5-5` (override: `VISION_MODEL`), effort `low` (a short classification; keeps the phone wait short), `max_tokens` 8000, 60 s timeout, 1 retry. **Structured outputs** (`betaZodOutputFormat(readingFormat)`) guarantee the reply's shape, so the parse failure seen with DeepSeek can't recur; `parseReading` still applies the lenient mapping. Server-side refusal fallback on (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`); a refusal or cut-off reply throws a readable error that the picker shows.
- `reading.ts`: `buildReadingContent` (full photo + labelled crops as base64 JPEG image blocks) replaces the OpenAI-style request; the JSON-extraction workarounds are gone. Env: `ANTHROPIC_API_KEY`, `VISION_MODEL`; mock renamed `VISION_MOCK` (launch config `dev-mock` updated). Health check reports `anthropic`.
- 105 tests; typecheck, lint and build clean. Mock reading verified end to end in `dev-mock` (inspo-7). `api.anthropic.com` is reachable from the Mac (401 without a key), so real readings can be tested locally. Test inspiration row deleted.

### Session 6, Oct 24, 2026: why the outlines looked wrong, and three outliner fixes
**Trigger:** the user's phone screenshot of the brown almond photo showed blobs on skin and satin instead of nails, after "rounds" with an agent.

**Diagnosis** (offline, with the real pipeline code on the photo cut out of the screenshot, then on the clean photo the user supplied)
- The blobs match the **colour flood** outliner, not MobileSAM: the thumb blob on the thumb pad, the index blob down the finger, the pinky blob out onto the satin. MobileSAM on the same photo gives 5/5 nails, in Node, in Chromium and in **iOS Simulator Safari** (iOS 18.7, encode ≈ 1 s).
- The screenshot (02:39 Casablanca = 01:39 UTC) predates the first SAM deploy (01:41 UTC), so it was the flood-only build. The picker gave no sign of which outliner ran, so every fix was judged against a screen that looked the same either way.
- One-tap MobileSAM is still weak on glossy and patterned nails: on the 4 photos the user supplied (`inspo-8` brown almond, `inspo-9` brown two hands, `inspo-10` black ombré, `inspo-11` smoke marble) a lone point gave fragments or the whole hand on 2–3 nails each, except inspo-8. Its "finger" guess often scores as high as the nail guess. A box of about the nail's size fixes most brown-photo misses; a box 1.6× too big leaks down the finger.

**Built** (0 units; 109 tests, typecheck, lint, build clean)
- **Status line** (`InspoPicker`, `data-testid="outliner-status"`): "Outlines by MobileSAM", or amber "MobileSAM couldn't run here (reason)" / "MobileSAM found no nail-sized shape under the … taps, so those outlines come from the colour outliner". `console.debug` logs each outline's area, score and box.
- **`chooseSamMask`**: a plausible guess ≥ 3× another plausible one is the finger and is dropped (before, it won on score: Chromium picked an 11,489 px nail+finger over the 1,783 px nail). With a typical nail known, a guess must be 0.4–1.8× it (was ≤ 2.5×). The tap may sit up to 2 px outside the mask (glare pixels).
- **Box prompt** (`nailPromptBox`, `nearTypical`, `samOutline`): the lone tap is tried first; if it gives nothing nail-sized, or something outside 0.6–1.6× the typical nail, the tap is sent again with a box of the typical nail's size (1.15× along, 1.3× across, axis-aligned) and that answer is used when plausible. `typicalPick` (median-area pick) supplies size and orientation. Using the box on every tap was worse (the thumb's diagonal bounding box is huge), hence second attempt only.
- Verified in `dev-mock` at phone size via a temporary page (deleted): inspo-8 5/5 by SAM; inspo-9 5/5 by SAM (before: 2 went to the flood), index/middle rough on the diagonal nails. Two test inspiration rows and files deleted; the user's sessions untouched.

**Phone test (after the push):** iPhone Safari, "Outlines by MobileSAM", 5/5 nails on the brown photo, reading shown per finger. The earlier bad screenshot was indeed the flood-only build.

**Known limits:** diagonal nails get a loose axis-aligned box; smoke/marble art still fragments (SAM follows the pattern); a half-hidden thumb picked first sets a too-small "typical" size (inspo-11: ring and pinky rejected as 3.4× it). Possible next steps: let the user tap tip and cuticle for a box, or take the median only after three picks.

### Session 7, Oct 24, 2026: automatic nail detection, finger swap, smooth outlines
The user asked whether nails could be found automatically on upload (with a way to fix a wrong finger) and for the jagged outlines to be smoothed.

**Gate first:** Claude (`claude-opus-5-5`, effort low) was asked for each nail's centre and finger on the 4 test photos (`test-output/locate.mjs`, git-ignored). All 24 nails got a point inside the painted surface, finger names plausible, two hands told apart (inspo-9 and inspo-10 report both hands), 3–11 s per photo, ≈ 2k input tokens. MediaPipe was ruled out (it finds no hand in inspiration close-ups, Oct 21) and a SAM point grid would need geometry to name fingers.

**Built** (0 units; 116 tests, typecheck, lint, build clean)
- `src/lib/vision/locate.ts` (pure, 3 tests): the structured-output format (hand number, finger, pixel centre, full/partial/hidden, confidence), `parseLocations` (→ fractions of the photo, hidden and out-of-frame dropped), `chooseHand` (most fully visible nails, then mean confidence; one entry per finger). `locateNails` in `claude.ts` (mock finds nothing, so free local tests stay manual). `POST /api/designs/locate` `{ inspoImageId }` → `NailLocations`.
- **Suggested picks** (`InspoPicker`): once the photo is stored and the outliner is ready, the picker asks for the locations and fills the fingers not yet tapped, outlining each like a tap (fully visible nails first, so a half-hidden thumb doesn't set the typical size). Once per photo; taps made meanwhile win; status line "Finding the nails in the photo…" / "All five nails found automatically. Check the labels…" / "Couldn't find the nails automatically (reason). Tap them instead."
- **Swap two fingers**: a button under the finger list enters swap mode; tapping a finger swaps the two taps (and their Design/Flip settings), for a nail detected as the wrong finger.
- **Smooth outlines** (`src/lib/inspo/contour.ts`, 4 tests): the mask boundary is traced (marching squares, largest loop), thinned, rounded twice (Chaikin) and drawn as an anti-aliased path on a 3× canvas instead of a pixel edge. The cut-out PNGs already blend their edge bilinearly and were left alone.
- `typicalPick` now needs two picks: a lone first pick was a 441 px glare fragment of the cut-off thumb on inspo-9 and shrank the index's size window so it fell to the flood.

**Verified** (`dev-live`, real Claude, no renders, phone size, temporary page deleted): inspo-9 (two hands) → all five found and outlined by MobileSAM in 11 s, labels right, swap thumb↔index moved the labels and colours; outlines smooth. Test inspiration row and file deleted.

**Known limits:** a cut-off thumb still gets a small fragment (SAM, not detection); the diagonal-nail box leak remains (ring on inspo-9); a two-hand photo gets the hand with most full nails, the other needs manual taps; detection adds ≈ 5–12 s and a few cents per photo.

### Session 8, Oct 25, 2026: Day 6, spec editor and before/after slider
The user chose to push on building and refine later (the true-colour composite decision stays parked).

**Built** (0 units; 117 tests, typecheck, lint, build clean)
- **Per-finger editor** (`InspoPicker`): tapping a nail in the finger list opens an editor (`data-testid="finger-editor"`): a colour input with "Back to the photo's colour", the nine finish chips, and "Apply to all nails". `applyEdits` (`pick.ts`, 1 test) lays the edits over the spec; a recoloured nail becomes plain colour with no accents (its design cut-out would still carry the photo's colour), and its Design switch is turned off. Edits follow a finger swap and reset with a new photo. The global Finish row still sets all five.
- **Before/after slider** (`CompareSlider.tsx`): the render with the original photo revealed up to a draggable handle (a full-size range input, so touch, mouse and keyboard all work), replacing "Hold to compare" in `TryOn`.

**Verified** (`dev-mock`, phone size, temporary page deleted): inspo-8 tapped manually (the mock finds no nails automatically, as designed); ring → #3366CC + Matte with Design off; Apply to all → all five #3366CC/matte; the slider splits the two images at the handle. Test inspiration row and file deleted.

**Not done (refine later):** per-finger editing in the one-colour mode (it has one colour and finish for all); shape and length per finger (one shape and length for the hand, as YouCam's press-on effect takes them).

### Session 9, Oct 25, 2026: true-colour composite in the render pipeline
The user asked for the composite (parked since Oct 21) to be built in, tested with mocks first.

**Built** (0 units; 129 tests, typecheck, lint, build clean)
- `src/lib/render/composite.ts` (pure, TypeScript port of the prototype): paint mask = OKLab change between hand and render, opened 5 px (drops YouCam's 1 px slivers); one component per nail; YouCam's lightness pattern (×0.8) recentred on the requested colour, highlights desaturated, photo grain added, soft 1.2 px edge.
- Two changes from the prototype, found on the real renders: (1) the base is **YouCam's render, not the bare hand**: the pale `#E2D7C9` accent nail was too close to the bare nail to detect and vanished; (2) each nail takes the colour of the **nearest MediaPipe fingertip** (stored hand landmarks; nearest-colour fallback without them): with five close greens, nearest-colour gave the middle nail another finger's green.
- Not applied to specs with design fingers: the mask split two-tone design nails and they came out torn.
- `compositeTargets(spec, landmarks)`; `composite-image.ts` decodes/resizes/encodes with **sharp** (now a direct dependency), caps the work size at 2048 px, refuses aspect mismatches (> 2 %), and reports "nothing recoloured" so the raw render is kept.
- `refreshRender`: after copying a finished Nail VTO render, composites it; the result is `renders/<id>.jpg`, YouCam's original stays as `renders/<id>-youcam.<ext>`. Any failure keeps YouCam's image (a paid render is never lost). Cached old renders are unchanged.
- Mock: `YOUCAM_MOCK_RESULT=<local image>` makes mock renders return that file (launch config `dev-mock-render`, reads `test-output/mock-render.png`, git-ignored).

**Verified**
- Offline on all 10 stored phone renders (downloaded from our storage, free): the 5 plain-colour ones composite in 0.35–1.5 s locally; coral chrome comes back coral (YouCam: red), middle green `#1D3326` for requested `#1E3427` (YouCam: `#304037`), the red smoke test barely changes. The 5 with design fingers are skipped.
- End to end in `dev-mock-render`: hand upload → render → poll → the stored result is the coral composite, original kept. No server errors. Test session, rows, ledger entry and the two render files deleted (the user's hand photo object, shared by content hash, kept).

**Known limits:** chrome streaks remain (softened); a pale polish close to the bare nail keeps YouCam's colour; Vercel timing of the composite (inside the status poll) not measured yet.

### Session 10, Oct 25, 2026: design cut-out cleanup
The user tried the deployed composite on the phone: natural length looked fine, **extensions looked cheap/fake**. Both renders used design fingers, so the composite didn't apply. Diagnosis on the stored renders and cut-outs (free): the inspiration photo is only 735×827; the cut-outs carried the photo's white glare slashes, a ragged base-colour fringe, a side-on sliver for the thumb and index (the same crop), and a pinky outline holding two nails; YouCam lays the press-on on as a flat sticker. The user chose to fix the cut-outs first.

**Built** (0 units; 138 tests, typecheck, lint, build clean)
- **Glare removal** (`removeGlare` in `design.ts`): near-white, colourless strokes clearly brighter than the nail around them, kept only when long (≥ 4× width), straight, at most 18 % of the image wide and **lengthwise** (≤ 35° from the nail's axis: a nail curves across its width, so highlights run along it; crosswise white lines, dots and French tips are art). The streak and its halo are filled from around (onion fill, then smoothed). On the real cut-outs the white slashes are gone; a faint lighter band remains.
- **Art from the nail's body** (`bodySpan`): the cut-out reads one fixed span across the nail (typical edges, ragged rim trimmed) instead of the whole box, so the art fills the width with no base-colour fringe. A per-row version was tried first and bent straight lines into zigzags (seen in the browser), so it was dropped.
- **Partial or blurry nails default to Colour** (`cutoutDetail`): side-on (width < 25 % of length), partial (fill < 0.58 or convexity < 0.78) or blurry (90th-percentile gradient of the cut-out < 0.015). Calibrated on the user's photo: the thumb sliver measured fill 0.50, convexity 0.73; whole nails ≥ 0.66 and ≥ 0.81. Shown under the finger ("partial nail", "side view", "blurry"); the user can still switch it to Design. Re-checked when switching to extensions. `data-detail` on each finger carries the reason and sharpness.
- **Touching nails split** (`separateTouching` in `region.ts`): an outline that falls apart into two big pieces under light erosion keeps only the tapped piece.
- Sharpness alone didn't separate the cases (natural-length scores bunch at 0.020–0.022; extension scores 0.025–0.028 for every nail, sliver included), so shape carries the decision and blur is only a safety net.

**Verified** in `dev-mock` (browser pane, phone size) on the user's inspiration photo with five taps: thumb flagged "partial nail" in both modes and defaulted to Colour; the ring cut-out lost its glare slash; art straight. The two test image rows and files were deleted (the browser pane reused an old local session).

**Known limits:** a faint band where glare was; a straight, lengthwise white stripe of real art would be removed too; the user's exact production outlines (from automatic detection) weren't reproducible locally (the vision mock finds no nails), so the two-nail split is covered by a unit test only.
