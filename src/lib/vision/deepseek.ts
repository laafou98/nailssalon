import "server-only";
import { serverEnv } from "@/lib/env";
import { FINGERS } from "@/lib/spec/types";
import { type CropInput, type DesignReading, buildReadingRequest, parseReading } from "./reading";

/**
 * DeepSeek's OpenAI-compatible chat API, used for one vision call per inspiration
 * photo. Costs a fraction of a cent (images bill at ≤ 384 tokens each), no YouCam units.
 * The user's network blocks api.deepseek.com, so locally DEEPSEEK_MOCK=1 stands in.
 */

const BASE_URL = "https://api.deepseek.com";
const TIMEOUT_MS = 45_000;

const mockEnabled = () => process.env.DEEPSEEK_MOCK === "1" && process.env.NODE_ENV !== "production";

/** A fixed, plausible reading: art on the ring finger, solid cream elsewhere. */
function mockReading(crops: CropInput[]): string {
  return JSON.stringify({
    is_nail_design: true,
    fingers: crops.map((c) => ({
      finger: c.finger,
      texture: c.finger === "ring" ? "shimmer_fine" : "cream",
      pattern: c.finger === "ring" ? "art" : "solid",
      confidence: 0.8,
    })),
    shape: "almond",
    length: "medium",
    summary: "Mock reading: glossy solid nails with a glitter accent on the ring finger",
  });
}

export async function readDesign(photoUrl: string, crops: CropInput[]): Promise<DesignReading> {
  const cropped = crops.map((c) => c.finger).filter((f) => FINGERS.includes(f));
  if (mockEnabled()) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return parseReading(mockReading(crops), cropped);
  }

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${serverEnv("DEEPSEEK_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildReadingRequest(serverEnv("DEEPSEEK_MODEL"), photoUrl, crops)),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`DeepSeek request failed (${res.status}): ${text.slice(0, 300)}`);
  let choice: { message?: { content?: unknown }; finish_reason?: string } | undefined;
  try {
    choice = (JSON.parse(text) as { choices?: (typeof choice)[] }).choices?.[0];
  } catch {
    throw new Error(`DeepSeek returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`DeepSeek returned no message (finish_reason ${choice?.finish_reason ?? "none"})`);
  }
  try {
    return parseReading(content, cropped);
  } catch (error) {
    // Keep the stop reason: "length" means the reply was cut off by max_tokens.
    throw new Error(`${error instanceof Error ? error.message : error} (finish_reason ${choice?.finish_reason ?? "none"})`);
  }
}
