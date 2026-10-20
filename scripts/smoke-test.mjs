// Smoke test for the YouCam nail APIs. Spends 2 units (1 Nail VTO + 1 Nail Transfer).
// Run: node --env-file=.env.local scripts/smoke-test.mjs
import { mkdir, writeFile } from "node:fs/promises";

const API = "https://yce-api-01.makeupar.com/s2s/v2.0";
const KEY = process.env.YOUCAM_API_KEY;
if (!KEY) throw new Error("YOUCAM_API_KEY missing — run with --env-file=.env.local");

// Public sample images from YouCam's own docs.
const HAND = "https://plugins-media.makeupar.com/strapi/assets/nail_user_photo_01_27d4260646.jpg";
const REFERENCE = "https://plugins-media.makeupar.com/strapi/assets/small_webp_ref_6_341b11df3d.png";

const headers = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function runTask(endpoint, body) {
  const started = Date.now();
  const res = await fetch(`${API}/task/${endpoint}`, { method: "POST", headers, body: JSON.stringify(body) });
  const created = await res.json();
  if (!res.ok) throw new Error(`${endpoint} create failed: ${JSON.stringify(created)}`);
  const taskId = created.data.task_id;
  console.log(`[${endpoint}] task created`);

  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`${API}/task/${endpoint}/${encodeURIComponent(taskId)}`, { headers });
    const status = await poll.json();
    const state = status.data?.task_status;
    if (state === "success" || state === "error") {
      console.log(`[${endpoint}] ${state} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      console.log(JSON.stringify(status, null, 2));
      return status;
    }
  }
}

async function saveResult(status, name) {
  const url = status.data?.results?.url ?? status.data?.results?.[0]?.url;
  if (!url) return console.log(`[${name}] no result url found — inspect the JSON above`);
  await mkdir("test-output", { recursive: true });
  const img = Buffer.from(await (await fetch(url)).arrayBuffer());
  await writeFile(`test-output/${name}.jpg`, img);
  console.log(`[${name}] saved test-output/${name}.jpg`);
}

// 1) Nail VTO: solid colour polish on every finger (exercises the per-finger spec format).
const fingers = ["thumb", "index", "middle", "ring", "pinky"];
const vto = await runTask("nail-vto", {
  version: "1.0",
  src_file_url: HAND,
  effect_type: "nail_polish",
  effects: fingers.map((finger) => ({
    sub_type: "color",
    finger,
    color: "#B0123A",
    texture: "cream",
    transparency: 0,
    reflection: 60,
    contrast: 50,
    roughness: 10,
  })),
});
await saveResult(vto, "nail-vto");

// 2) Nail Transfer: reference design onto the same hand.
const transfer = await runTask("ai-nail", { src_file_url: HAND, ref_file_url: REFERENCE });
await saveResult(transfer, "nail-transfer");
