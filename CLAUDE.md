# NailsSalon

Hackathon entry for the YouCam API Skin AI & eCommerce VTO Hackathon (submit by **Nov 1, 2026**).
A nail design compiler: inspiration photo → editable per-finger spec → rendered on the client's hand via YouCam Nail VTO / Nail Transfer → matched to the salon's real polishes → WhatsApp recipe card.

## Start every session here
1. Read [docs/PROGRESS.md](docs/PROGRESS.md): current day, last session, open items, next step.
2. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design of the component you're working on.
3. At the end of the session, add a session entry to `docs/PROGRESS.md`, update the tracker table and the "Current status" block, then commit.

## Working agreement
- The user tests on their phone against the Vercel deployment. Pushing to `main` deploys, so commit freely but ask before each push.
- Claude builds; the user reviews and refines. Explain changes in plain language.
- Never put API keys in client code, commits or chat. Keys live in `.env.local` (git-ignored) and in Vercel env vars.
- Be careful with YouCam units (1,000 total, about 1 per render). Prefer mocked tests; real calls only when validating.
- Commit with the repo-local `laafou98` noreply identity (already configured).

## Commands
- `npm run dev`, `npm run build`, `npm test` (Vitest), `npm run typecheck`, `npx eslint src`
- Locally, Node's outbound fetch needs `NODE_USE_ENV_PROXY=1` (sandbox proxy), e.g. `NODE_USE_ENV_PROXY=1 npm run dev`.
- Free end-to-end testing: `NODE_USE_ENV_PROXY=1 YOUCAM_MOCK=1 npm run dev` (launch config `dev-mock`). Mock renders return the hand photo after 3 s; colour `#000001` makes one fail. Still writes real rows to Supabase, so clean up test sessions afterwards.
- Launch configs (`.claude/launch.json`): `dev` (plain), `dev-mock` (proxy + fake YouCam, free), `dev-live` (proxy + real YouCam; polling a finished task is free, new renders cost units).
- Check a deploy: `gh api repos/laafou98/nailssalon/commits/<sha>/status` (the Vercel MCP gets 403 on deployments and logs).
- YouCam smoke test (2 units): `NODE_USE_ENV_PROXY=1 node --env-file=.env.local scripts/smoke-test.mjs`

## Gotchas
- Next.js 16.4 with breaking changes: read `node_modules/next/dist/docs/` before using unfamiliar APIs (see AGENTS.md). Cache Components is on; use `await connection()` in dynamic GET handlers.
- The user's network (Zscaler) blocks `api.deepseek.com`. Test DeepSeek through the Vercel deployment.
- YouCam result URLs expire after 2 h. Copy them to Supabase Storage straight away.
- Supabase project ref: `cgfneztejdpqkfflonzj`. Add schema changes as new files in `supabase/migrations/` and apply them via the Supabase MCP.
- `server-only` is aliased to an empty module in Vitest (`vitest.config.mts`).

@AGENTS.md
