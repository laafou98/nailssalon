# NailsSalon: Progress Log

Living record of where the build stands. **Update this at the end of every working session.**
The plan and design live in [ARCHITECTURE.md](ARCHITECTURE.md). The hackathon brief and strategy live in Notion (Apptupia → "YouCam Hackathon Brief").

## Current status

- **Day:** 1 of 12 done (Oct 20, 2026). Next: **Day 2, Hand Quality Gate**.
- **Deadline:** submit by **Nov 1, 2026**. The official deadline is Nov 2, 11:45 am ET (4:45 pm Casablanca).
- **Live:** https://nailssalon-five.vercel.app, which auto-deploys from `main`. Health check at `/api/health`.
- **Repo:** https://github.com/laafou98/nailssalon (public, MIT)
- **YouCam units used:** 2 of 1,000 (smoke test on Oct 20).

## Build plan tracker

| Day | Date | Deliverable | Status |
|---|---|---|---|
| 1 | Oct 20–21 | Scaffold, Supabase schema + RLS, YouCam client, deploy | ✅ Done |
| 2 | Oct 22 | [A] Hand Quality Gate with live guidance | ⏭ Next |
| 3 | Oct 23 | `DesignSpec` + `toNailVtoPayload` + render route + cache + unit ledger | |
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

**Next step:** Day 2, the Hand Quality Gate (`@mediapipe/tasks-vision` HandLandmarker in the browser: one hand, palm ≥ 50% of the frame, 5 fingertips in frame, back of hand, blur and exposure checks, live guidance overlay).
