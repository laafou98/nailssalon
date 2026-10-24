import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { serverEnv } from "@/lib/env";
import { FINGERS } from "@/lib/spec/types";
import { type CropInput, type DesignReading, SYSTEM, buildReadingContent, parseReading, readingFormat } from "./reading";

/**
 * Claude reads each inspiration photo once (full photo + one crop per tapped nail).
 * Structured outputs guarantee the reply matches `readingFormat`; no YouCam units.
 * Locally VISION_MOCK=1 returns a fixed reading for free tests.
 */

const mockEnabled = () => process.env.VISION_MOCK === "1" && process.env.NODE_ENV !== "production";

/** A fixed, plausible reading: art on the ring finger, solid cream elsewhere. */
function mockReading(crops: CropInput[]) {
  return {
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
  };
}

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: serverEnv("ANTHROPIC_API_KEY"), timeout: 60_000, maxRetries: 1 }));

export async function readDesign(photoBase64: string, crops: CropInput[]): Promise<DesignReading> {
  const cropped = crops.map((c) => c.finger).filter((f) => FINGERS.includes(f));
  if (mockEnabled()) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return parseReading(mockReading(crops), cropped);
  }

  const response = await anthropic().beta.messages.parse({
    model: serverEnv("VISION_MODEL"),
    max_tokens: 8000,
    system: SYSTEM,
    messages: [{ role: "user", content: buildReadingContent(photoBase64, crops) }],
    // A short classification: low effort keeps the phone waiting seconds, not tens of seconds.
    output_config: { effort: "low", format: betaZodOutputFormat(readingFormat) },
    // If a safety classifier declines, the API retries on a fallback model in the same call.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined to read this photo (${response.stop_details?.category ?? "no category"})`);
  }
  if (response.stop_reason === "max_tokens") throw new Error("Claude's reading was cut off (max_tokens)");
  if (!response.parsed_output) throw new Error(`Claude's reply didn't match the reading format (stop: ${response.stop_reason})`);
  return parseReading(response.parsed_output, cropped);
}
