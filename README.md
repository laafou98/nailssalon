# NailsSalon

**Inspiration photo → exact, editable per-finger spec → rendered on your own hand → matched to your salon's real polishes.**

Built for the [YouCam API Skin AI & eCommerce VTO Hackathon](https://youcam-api-skin-ai-ecommerce.devpost.com/).

Clients bring nail techs blurry screenshots. NailsSalon turns any inspiration photo into a structured design spec (colour, finish, shape, length and art for each finger), renders it on the client's own hand with the YouCam AI Nail APIs, matches every colour to polishes the salon actually stocks, and sends the tech a precise recipe card over WhatsApp.

> 🚧 Work in progress. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design and build plan.

## YouCam APIs used

| API | Role |
|---|---|
| **AI Nail Virtual Try-On** | Main renderer. Each finger is driven from our compiled spec (hex colour, finish, shape, length, design image). |
| **AI Nail Transfer** | Fallback for complex hand-painted art the compiler can't express with confidence. |

## Tech stack

Next.js (App Router, TypeScript) · Tailwind CSS · Supabase (Postgres, Storage, Auth) · MediaPipe Hand Landmarker · culori (colour science) · DeepSeek (vision) · Vitest · Vercel

## Running locally

Requirements: Node.js 20.9+ (developed on Node 24), a Supabase project, a YouCam API key and a DeepSeek API key.

```bash
git clone https://github.com/laafou98/nailssalon.git
cd nailssalon
npm install
cp .env.example .env.local   # then fill in the keys
```

Apply the database schema: run the SQL files in [`supabase/migrations/`](supabase/migrations) in order (Supabase dashboard → SQL Editor, or `supabase db push` with the Supabase CLI).

```bash
npm run dev        # http://localhost:3000
npm test           # unit tests
npm run typecheck
```

`GET /api/health` reports database connectivity and which server keys are configured. It never spends YouCam units.

### Environment variables

| Variable | Where it's used |
|---|---|
| `YOUCAM_API_KEY` | Server only. YouCam task APIs. |
| `DEEPSEEK_API_KEY` | Server only. Design extraction from inspiration photos. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key (browser-safe). |
| `SUPABASE_SECRET_KEY` | Server only. Service-role access for the pipeline tables. |
| `UNITS_SESSION_CAP`, `UNITS_GLOBAL_CAP` | Caps on YouCam unit spend per session and in total. |

### Smoke test

`scripts/smoke-test.mjs` runs one Nail VTO and one Nail Transfer task against YouCam's public sample images (2 units) and saves the results to `test-output/`:

```bash
node --env-file=.env.local scripts/smoke-test.mjs
```

## License

[MIT](LICENSE)
