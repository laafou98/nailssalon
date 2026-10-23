# NailsSalon: Architecture & Build Plan

> Inspiration photo → exact, editable per-finger spec → rendered on the client's own hand → matched to the salon's real polishes → recipe card on WhatsApp → finished nails scored against the spec.

YouCam renders. We do the work around it: hand-photo gating, per-finger design extraction, render routing, colour science, salon stock matching and fidelity scoring.

---

## 1. System overview

```
┌──────────────────────── Browser (mobile-first PWA) ────────────────────────┐
│  Camera / upload                                                           │
│   └─► [A] Hand Quality Gate  (MediaPipe HandLandmarker, WASM, free)        │
│          one hand · palm ≥ 50% · nails in frame · blur · exposure          │
│   └─► [B] Tap-to-pick nail crops on the inspiration photo                  │
│          tap thumb → pinky · OKLab region flood · k-means colours          │
│   └─► Spec editor UI (shape, length, colour, finish per finger)            │
└───────────────┬────────────────────────────────────────────────────────────┘
                │ HTTPS (Next.js route handlers; YouCam key never leaves server)
┌───────────────▼──────────────── Next.js on Vercel (server) ────────────────┐
│  [C] Design Compiler    crops → colour clustering (OKLab k-means)          │
│                         + vision LLM → finish / pattern / shape / conf.    │
│                         → DesignSpec JSON + per-finger design PNGs         │
│  [D] Render Router      spec → Nail VTO (colour | design) or Nail Transfer │
│                         cache by hash(hand, spec) · unit budget guard      │
│  [E] Shade & Stock      skin tone from hand → undertone → ΔE2000 matching  │
│                         against salon polish catalogue · price/time est.   │
│  [F] Fidelity Scorer    "after" photo → same extraction → per-finger ΔE    │
│  YouCam client          create task → poll → copy result to our storage    │
└───────────────┬────────────────────────────────────────────────────────────┘
                │
┌───────────────▼──────── Supabase ────────┐      ┌──────── YouCam API ──────┐
│ Postgres: salons, polishes, sessions,    │      │ nail-vto   (1 unit)      │
│   designs, renders, recipes, unit_ledger │      │ ai-nail    (1 unit)      │
│ Storage: hands/, inspo/, designs/,       │◄────►│ inputs via signed URLs   │
│   renders/ (results copied; YouCam URLs  │      │ results expire in 2 h    │
│   expire in 2 h)                         │      └──────────────────────────┘
│ Auth: salon owners only (magic link)     │
└──────────────────────────────────────────┘
```

**Users**
- **Salon/tech** (signed in): manages polish catalogue, prices, WhatsApp number; shares their link.
- **Client** (no account): opens `nailssalon.app/s/<salon-slug>`, tries designs, sends recipe card.

---

## 2. The core data structure: `DesignSpec`

Everything flows through this. It is what makes designs editable, comparable and renderable.

```ts
type Finger = "thumb" | "index" | "middle" | "ring" | "pinky";

interface DesignSpec {
  version: 1;
  source: { kind: "inspiration" | "catalogue" | "manual"; imageId?: string };
  effectType: "nail_polish" | "press_on_nails";
  shape?: PressOnShape;           // e.g. "almond_oval" (press-on only, 15 options)
  length?: number;                // 0.8–2.15 (press-on only)
  fingers: Record<Finger, FingerSpec>;
  confidence: number;             // 0–1, overall extraction confidence
}

interface FingerSpec {
  kind: "color" | "design";
  baseHex: string;                // dominant colour (OKLab k-means)
  accentHexes: string[];          // secondary colours, for design nails
  texture: "matte" | "cream" | "jelly" | "sheer" | "metallic" | "pearl"
         | "shimmer_fine" | "shimmer_coarse" | "textured";
  pattern: "solid" | "french" | "ombre" | "cat_eye" | "art";
  designImageId?: string;         // per-finger PNG, when kind = "design"
  confidence: number;
  polishMatch?: { polishId: string; deltaE: number };   // filled by [E]
}
```

`DesignSpec` → YouCam payload is a pure function (`toNailVtoPayload(spec, handUrl)`), unit-tested against the documented schema.

---

## 3. Components

### [A] Hand Quality Gate (browser, 0 units)
- `@mediapipe/tasks-vision` HandLandmarker (WASM, ~5 MB, lazy-loaded).
- Checks, mirroring YouCam's documented failure modes:
  - exactly 1 hand (`numHands: 2`, reject if 2)
  - palm ≥ half the image area (Nail VTO guidance): we auto-crop around the hand to 1:1, 3:4 or 4:3, then check the hand box covers ≥ 50% of the crop
  - all 5 fingertip landmarks inside the frame
  - back of hand facing the camera: handedness label (treated as the anatomical hand for un-mirrored photos) + landmark winding
  - pose: hand turned ≤ 30° from flat (2D knuckle-width / palm-length ratio; direction from landmark z). MediaPipe's 3D world landmarks proved useless for this
  - sharpness: variance of Laplacian on fingertip crops
  - exposure: mean luminance in range
- Live guidance overlay: one headline ("Turn your hand flat: bring your little finger towards the camera", "Too dark") plus a 3D hand card that mirrors the hand's turn and flips to a palm face when the palm shows. Auto-capture only when the pose passes.
- Capture: full-resolution `ImageCapture.takePhoto()` where supported (Chrome/Android), else the video frame (iOS).
- Output: normalised JPEG (long side ≤ 2048, aspect 1:1, 3:4 or 4:3), plus landmarks JSON. Uploaded to `POST /api/hands`.

### [B] Nail crops (browser)
> **Changed Oct 21:** MediaPipe can't find hands in real inspiration photos, so inspiration photos use **tap-to-pick** (`src/lib/inspo/`): the user taps the nails thumb → pinky, each tap is outlined by an OKLab region flood and measured with k-means. The landmark approach below still applies to the client's own hand photo.

Original plan (landmark-guided):
The key technique. Nail Transfer shuffles designs across fingers. We avoid that by locating each finger explicitly.
- Run HandLandmarker on the **inspiration photo** too.
- For each finger, use the TIP (4/8/12/16/20) and DIP (3/7/11/15/19) landmarks. The direction DIP→TIP gives the nail axis. Take a rotated crop centred ~70% of the way from DIP to TIP, sized to finger width.
- Result: 5 upright, per-finger nail crops labelled by finger.
- Fallback when no hand is detected (e.g. press-on product shot): send the whole image to the vision model for boxes, or route to Nail Transfer (see [D]).

### [C] Design Compiler (server)
1. **Colour:** done in the browser by tap-to-pick (`src/lib/inspo/colours.ts`): k-means in OKLab on each outlined nail, skipping glare and skin at the border → `baseHex`, `accentHexes`.
2. **Semantics:** one vision-LLM call per inspiration image with the 5 crops + full image (`src/lib/vision/`, `POST /api/designs/extract`, after the fifth tap). Returns per-finger `texture`, `pattern`, `confidence`, and global `shape`/`length` estimates, as JSON parsed leniently with zod. The pattern sets the Design/Colour default (solid → Colour; french/ombre/cat_eye/art → Design); shape/length are the Extensions defaults.
3. **Design PNGs:** built in the browser (`src/lib/inspo/design.ts`): each tapped nail is cut out along its axis, tip up, outside-the-outline filled with its base colour, sized into Nail VTO's limits (width 271–542, height 522–1044, ≤ 1 MB). Two fits: "Keep my length" (polish on natural nails: the busiest 1.3 × width stretch of the art, opaque) and "Extensions" (`press_on_nails`, `<tip>_oval` shape + length guessed from the outline's taper and aspect: the whole nail on a transparent background). Uploaded via `POST /api/designs/images` to `designs/<sha256>.png`. For now the user chooses Design or Colour per finger; later the vision model's `pattern` sets the default (art/french/ombre/cat_eye → design).
4. **Confidence:** combines landmark visibility, crop sharpness, cluster separation and LLM confidence.

### [D] Render Router (server)
```
if spec.confidence ≥ 0.6 → Nail VTO
    each finger: kind = color  → sub_type "color" (hex + texture params)
                 kind = design → sub_type "design" + ref_file_url (our PNG)
else                         → Nail Transfer (hand + raw inspiration), labelled "approximate"
```
- Built Oct 23 as `chooseEngine` (`src/lib/render/router.ts`): Transfer only for inspiration specs with a stored photo (`source.imageId`); the request may force an engine (the "Compare" button, "Render each finger exactly instead").
- **Cache:** key = `sha256(handImageHash + canonicalJSON(spec))`. Identical requests never spend a unit twice.
- **Unit guard:** `unit_ledger` table; hard caps per session (e.g. 15) and global (e.g. 900); the demo never overdraws.
- **Polling:** create task, poll every 2 s (observed 7–10 s end-to-end), 60 s timeout; client polls our `/api/renders/:id`.
- **Persistence:** result copied to Supabase Storage immediately (YouCam URLs expire in 2 h).
- **Edit loop:** "Make it almond, shorter" changes `shape`/`length` in the spec → new render; everything else stays. This is the demo moment Nail Transfer cannot do.

### [E] Shade & Stock Engine (server, 0 units)
- **Skin tone from the hand photo:** sample the back-of-hand polygon (landmarks 0, 5, 9, 13, 17), remove specular and shadow outliers, take the median in CIELAB.
- **Undertone:** hue angle `h = atan2(b*, a*)` → warm / neutral / cool bands, plus L* depth (light / medium / deep).
- **Stock matching:** for each `FingerSpec`, CIEDE2000 against the salon's `polishes` (filtered by compatible finish). Best match plus up to 2 alternates, with plain-language explanations ("ΔE 1.8: practically identical"; "warm red on warm undertone").
- **Quote:** price and chair time from salon-defined rules: base service + per-finger art tier (solid / french / art) + length/shape surcharge.

### [F] Fidelity Scorer (server, 0 units)
- Tech or client uploads an "after" photo. Run [A] + [B] + [C] on it.
- Per finger: ΔE between spec `baseHex` and observed colour; pattern match; overall score (weighted), shown as "91% match" with per-finger breakdown.
- Honest output: fingers with low confidence are shown as "couldn't measure", not guessed.

### Recipe card & WhatsApp hand-off
- Server-rendered image (OG-image style via `@vercel/og`) + a share page `/r/<id>`: hand render, per-finger hex, finish, matched polish names, shape/length, quote.
- `https://wa.me/<salon-number>?text=<prefilled message + recipe link>`. No booking system.

---

## 4. Data model (Supabase / Postgres)

| Table | Key columns |
|---|---|
| `salons` | id, slug, name, whatsapp, city, currency (MAD), locale, owner_id |
| `polishes` | id, salon_id, brand, name, hex, lab (L,a,b), finish, in_stock |
| `price_rules` | salon_id, base_price, art_tiers jsonb, length_surcharge, minutes jsonb |
| `sessions` | id, salon_id, created_at, units_used |
| `images` | id, session_id, kind (hand / inspo / design / render / after), path, sha256, landmarks jsonb |
| `designs` | id, session_id, spec jsonb, confidence, source_image_id |
| `renders` | id, design_id, hand_image_id, cache_key (unique), engine (vto / transfer), youcam_task_id, status, result_image_id |
| `recipes` | id, design_id, render_id, quote jsonb, polish_matches jsonb |
| `fidelity_checks` | id, recipe_id, after_image_id, score, per_finger jsonb |
| `unit_ledger` | id, session_id, engine, units, created_at |

RLS: salon owners read/write their own salon rows. Client sessions are accessed only through server route handlers (service role), never directly from the browser.

---

## 5. API routes (Next.js route handlers)

| Route | Purpose |
|---|---|
| `POST /api/hands` | Gated hand photo → `images` row |
| `POST /api/inspirations` | Inspiration photo (JPEG) → `images` row (vision input, Transfer reference) |
| `POST /api/designs/images` | Per-finger design PNG → `images` row |
| `POST /api/designs/extract` | Stored inspiration + per-finger crops → vision reading (finish, pattern, shape, length) |
| `PATCH /api/designs/:id` | Edit spec (shape, length, colour, finish) |
| `POST /api/renders` | Spec + hand → cache hit or new YouCam task |
| `GET /api/renders/:id` | Status / result (client polls) |
| `GET /api/designs/:id/matches` | Polish matches + quote for a salon |
| `POST /api/recipes` | Create recipe card + WhatsApp link |
| `POST /api/fidelity` | After photo → score |

---

## 6. Tech stack

| Concern | Choice |
|---|---|
| Framework | Next.js (App Router, TypeScript), deployed on Vercel |
| UI | Tailwind CSS, mobile-first; RTL support for Arabic |
| i18n | `next-intl`: English (judges), French, Arabic |
| Hand landmarks | `@mediapipe/tasks-vision` (browser) |
| Colour science | `culori` (OKLab, CIELAB, CIEDE2000) |
| Image processing | `sharp` (server) |
| Vision model | DeepSeek V4.1 Flash (`deepseek-flash`, OpenAI-compatible, image input), structured JSON validated with zod. Blocked on the user's network: test via Vercel |
| DB / storage / auth | Supabase |
| Validation | `zod` |
| Tests | Vitest for spec → payload, colour maths, router, cache keys |

---

## 7. What makes this non-trivial (for the Technology criterion)

1. Per-finger, landmark-guided extraction that keeps designs on the right finger. Raw Nail Transfer does not.
2. A typed design spec compiled into YouCam's per-finger effect schema, with an edit loop.
3. Routing between two YouCam engines based on measured confidence.
4. Real colour science: OKLab clustering, CIEDE2000 matching, undertone from the hand itself (0 units, versus 20 for the face analyser).
5. Cost engineering: free browser gating before any unit is spent, content-addressed caching, a unit ledger.
6. A closed loop: spec → render → real nails → measured fidelity.

---

## 8. Build plan (Oct 21 – Nov 1; submit Nov 1)

| Day | Date | Deliverable |
|---|---|---|
| 1 | Oct 21 | Scaffold Next.js + Supabase, schema + RLS, YouCam server client, deploy skeleton to Vercel |
| 2 | Oct 22 | [A] Hand Quality Gate with live guidance |
| 3 | Oct 23 | `DesignSpec` + `toNailVtoPayload` + render route + cache + unit ledger (tests) |
| 4 | Oct 24 | [B] tap-to-pick nail crops on inspiration photos (landmarks failed on real photos); colour clustering |
| 5 | Oct 25 | [C] vision-LLM semantics + design PNG generation; router [D] with Transfer fallback |
| 6 | Oct 26 | Spec editor UI (shape, length, colour, finish per finger), before/after compare |
| 7 | Oct 27 | [E] skin tone, undertone, polish matching, quote rules; salon admin (catalogue) |
| 8 | Oct 28 | Recipe card image + share page + WhatsApp hand-off |
| 9 | Oct 29 | [F] fidelity scorer; i18n (FR, AR + RTL) |
| 10 | Oct 30 | Real-photo testing (own hand, messy screenshots), failure states, polish |
| 11 | Oct 31 | Demo video, screenshots, README, Devpost text |
| 12 | Nov 1 | Buffer, final QA, **submit** |

**Cut order if behind:** fidelity scorer → Arabic/RTL → press-on shapes → salon admin UI (seed the catalogue instead).

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Landmarks fail on cropped inspiration photos (no full hand) | **Happened (Oct 21).** Switched to tap-to-pick; the vision model may pre-place taps later; Nail Transfer stays the "approximate" fallback |
| Renders look "pasted on" (chrome streaks, hue drift, too clean on noisy photos) | Full-res capture; Cream as the default finish; optional true-colour composite (`scripts/prototypes/`), decision pending |
| Design PNGs look poor in VTO | Test in week 1; fall back to colour + pattern params, or Transfer, for art nails |
| Units run out | Cache, per-session caps, global ledger; ~1 unit per render; social bonus (+1,000) |
| Skin-tone accuracy under bad light | Exposure gate in [A]; show confidence; let the user pick undertone manually |
| Judges only watch the video | Demo script shows each technical piece visibly, with numbers on screen |

---

## 10. Accounts & keys needed

- `YOUCAM_API_KEY`: ✅ in `.env.local`
- Supabase project: URL + anon key + service role key
- `DEEPSEEK_API_KEY` (vision extraction): ✅ set in `.env.local` and on Vercel
- Vercel project (GitHub repo connected)
