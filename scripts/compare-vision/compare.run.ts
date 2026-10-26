// Model comparison for the two vision calls (nail locations, design reading), using
// the app's own prompts and formats. Costs real API credit, so it only runs on demand:
//   NODE_USE_ENV_PROXY=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run -c scripts/compare-vision/vitest.config.mts
// Writes test-output/model-compare/results.json and one overlay PNG per photo and model.

import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import sharp from "sharp";
import { test } from "vitest";
import { type NailLocations, chooseHand, locateFormat, locateSystem, parseLocations } from "@/lib/vision/locate";
import { type CropInput, SYSTEM, buildReadingContent, readingFormat } from "@/lib/vision/reading";
import { FINGERS } from "@/lib/spec/types";

const MODELS = [
  { id: "claude-opus-5-5", input: 4, output: 20, fallbacks: true },
  { id: "claude-sonnet-5-5", input: 2, output: 10, fallbacks: true },
  // Haiku has no server-side refusal fallback.
  { id: "claude-haiku-5-5", input: 0.1, output: 0.5, fallbacks: false },
] as const;
type Model = (typeof MODELS)[number];
const REPS = Number(process.env.REPS ?? 2);
const PHOTOS_DIR = process.env.PHOTOS_DIR ?? "test-output/inspo";
const OUT = "test-output/model-compare";
const COLOURS = ["#00ff00", "#ffcc00", "#ff00ff"];

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 1 });

async function call<T>(model: Model, system: string, content: Anthropic.Beta.BetaContentBlockParam[], format: Parameters<typeof betaZodOutputFormat>[0], maxTokens: number) {
  const t0 = Date.now();
  const response = await client.beta.messages.parse({
    model: model.id,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content }],
    output_config: { effort: "low", format: betaZodOutputFormat(format) },
    ...(model.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });
  const ms = Date.now() - t0;
  const { input_tokens: inTok, output_tokens: outTok } = response.usage;
  const cost = (inTok * model.input + outTok * model.output) / 1e6;
  return { ms, inTok, outTok, cost, stop: response.stop_reason, servedBy: response.model, parsed: response.parsed_output as T | null };
}

async function crops(photo: Buffer, w: number, h: number, picks: ReturnType<typeof chooseHand>): Promise<CropInput[]> {
  const pts = picks.flatMap((p) => (p ? [[p.x * w, p.y * h]] : []));
  const gaps = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1])).sort((a, b) => a - b);
  const side = Math.round(gaps.length ? Math.max(48, gaps[Math.floor(gaps.length / 2)] * 0.9) : Math.min(w, h) * 0.18);
  const out: CropInput[] = [];
  for (const [i, p] of picks.entries()) {
    if (!p) continue;
    const left = Math.max(0, Math.min(w - side, Math.round(p.x * w - side / 2)));
    const top = Math.max(0, Math.min(h - side, Math.round(p.y * h - side / 2)));
    const buf = await sharp(photo).extract({ left, top, width: Math.min(side, w), height: Math.min(side, h) }).resize(384, 384, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer();
    out.push({ finger: FINGERS[i], jpegBase64: buf.toString("base64") });
  }
  return out;
}

async function overlay(photo: Buffer, w: number, h: number, runs: { model: string; loc: NailLocations | null }[], file: string) {
  let svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">`;
  runs.forEach((r, m) => {
    for (const n of r.loc?.nails ?? []) {
      svg += `<circle cx="${n.x * w}" cy="${n.y * h}" r="${w / 70}" fill="none" stroke="${COLOURS[m]}" stroke-width="3"/>`;
      svg += `<text x="${n.x * w + w / 60 + m * (w / 30)}" y="${n.y * h}" fill="${COLOURS[m]}" font-size="${w / 32}" font-family="sans-serif" stroke="black" stroke-width="1">${n.finger[0].toUpperCase()}${n.hand}</text>`;
    }
  });
  runs.forEach((r, m) => (svg += `<text x="10" y="${30 + m * 30}" fill="${COLOURS[m]}" font-size="24" font-family="sans-serif" stroke="black" stroke-width="1">${r.model}</text>`));
  svg += "</svg>";
  await sharp(photo).composite([{ input: Buffer.from(svg) }]).png().toFile(file);
}

test("compare vision models", { timeout: 60 * 60_000 }, async () => {
  mkdirSync(OUT, { recursive: true });
  const results: unknown[] = [];
  const photos = readdirSync(PHOTOS_DIR).filter((f) => f.endsWith(".jpg")).sort();
  for (const name of photos) {
    // Same preparation as the picker: long side ≤ 1536, JPEG.
    const { data: photo, info } = await sharp(`${PHOTOS_DIR}/${name}`).rotate().resize(1536, 1536, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height;
    const image: Anthropic.Beta.BetaContentBlockParam = { type: "image", source: { type: "base64", media_type: "image/jpeg", data: photo.toString("base64") } };

    // Locations: every model, REPS times, all in parallel.
    const locRuns = await Promise.all(
      MODELS.flatMap((model) =>
        Array.from({ length: REPS }, async (_, rep) => {
          try {
            const r = await call<typeof locateFormat._output>(model, locateSystem(w, h), [image, { type: "text", text: "Locate every fingernail." }], locateFormat, 4000);
            const loc = r.parsed ? parseLocations(r.parsed, w, h) : null;
            return { photo: name, task: "locate", model: model.id, rep, ...r, parsed: undefined, loc, picks: loc ? chooseHand(loc) : null };
          } catch (e) {
            return { photo: name, task: "locate", model: model.id, rep, error: String(e) };
          }
        }),
      ),
    );
    results.push(...locRuns);
    await overlay(photo, w, h, MODELS.map((m) => ({ model: m.id, loc: (locRuns.find((r) => r.model === m.id && r.rep === 0) as { loc?: NailLocations })?.loc ?? null })), `${OUT}/${name.replace(".jpg", "")}-locate.png`);

    // Reading: same crops for every model, cut around Opus's first answer.
    const ref = locRuns.find((r) => r.model === MODELS[0].id && r.rep === 0) as { picks?: ReturnType<typeof chooseHand> | null };
    if (!ref?.picks) continue;
    const cropInputs = await crops(photo, w, h, ref.picks);
    for (const c of cropInputs) writeFileSync(`${OUT}/${name.replace(".jpg", "")}-crop-${c.finger}.jpg`, Buffer.from(c.jpegBase64, "base64"));
    const readRuns = await Promise.all(
      MODELS.flatMap((model) =>
        Array.from({ length: REPS }, async (_, rep) => {
          try {
            const r = await call<typeof readingFormat._output>(model, SYSTEM, buildReadingContent(photo.toString("base64"), cropInputs), readingFormat, 8000);
            return { photo: name, task: "read", model: model.id, rep, ...r };
          } catch (e) {
            return { photo: name, task: "read", model: model.id, rep, error: String(e) };
          }
        }),
      ),
    );
    results.push(...readRuns);
    console.log(`${name}: done`);
    writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
  }
});
