// Render Router [D]: which YouCam engine renders a spec. Pure, shared by the
// server (which decides) and the browser (which explains the decision).

import type { DesignSpec } from "@/lib/spec/types";

export const ENGINE_NAMES = ["nail_vto", "nail_transfer"] as const;
export type EngineName = (typeof ENGINE_NAMES)[number];
/** What the caller asks for: an engine, or "auto" to let the router decide. */
export type EngineChoice = EngineName | "auto";

/** Below this spec confidence our per-finger extraction isn't trusted. */
export const TRANSFER_BELOW = 0.6;

/**
 * Nail VTO renders our per-finger spec exactly; Nail Transfer copies the raw
 * inspiration photo (approximate: it can move designs between fingers and blur
 * fine detail). Auto picks Transfer only for an inspiration spec we're unsure of.
 */
export function chooseEngine(spec: DesignSpec, choice: EngineChoice = "auto"): EngineName {
  if (choice !== "auto") return choice;
  const hasPhoto = spec.source.kind === "inspiration" && Boolean(spec.source.imageId);
  return hasPhoto && spec.confidence < TRANSFER_BELOW ? "nail_transfer" : "nail_vto";
}
