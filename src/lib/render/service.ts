import "server-only";
import { serverEnv } from "@/lib/env";
import { type DesignSpec } from "@/lib/spec/types";
import { renderCacheKey, toNailVtoPayload, toTransferPayload, transferCacheKey } from "@/lib/spec/payload";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getObject, putObject, sha256, signedUrl, upsertImage } from "@/lib/supabase/storage";
import { ENGINES, YouCamError, createTask, getTask } from "@/lib/youcam/client";
import { compositeTargets } from "./composite";
import { compositeRender } from "./composite-image";
import { sniffImageType } from "./image-type";
import { type EngineChoice, type EngineName, chooseEngine } from "./router";

/**
 * Render [D]. The router picks the engine: Nail VTO renders the per-finger spec,
 * Nail Transfer copies the raw inspiration photo when the spec isn't trusted. One render = one YouCam unit, guarded three ways:
 *  1. cache: identical (hand photo, visible spec) requests reuse the first render;
 *  2. unit ledger: per-session and global caps, reserved atomically before the call;
 *  3. refunds: a render that fails gives its unit back (YouCam only charges successes).
 * Results are copied into our storage immediately (YouCam URLs expire after 2 h), then plain-colour
 * Nail VTO renders get the true-colour composite (exact requested hue, photo grain; see composite.ts).
 */

export type RenderView =
  | { id: string; engine: EngineName; status: "running" }
  | { id: string; engine: EngineName; status: "success"; resultUrl: string; cached: boolean }
  | { id: string; engine: EngineName; status: "error"; error: string };

export class RenderError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
  }
}

/** Give up on a task YouCam hasn't finished after this long (observed: 7–10 s). */
const TASK_TIMEOUT_MS = 2 * 60_000;

interface RenderRow {
  id: string;
  engine: EngineName;
  status: "pending" | "running" | "success" | "error";
  error: string | null;
  youcam_task_id: string | null;
  created_at: string;
  result: { path: string } | null;
  hand: { session_id: string | null; path: string; landmarks: unknown } | null;
  design: { spec: DesignSpec } | null;
}

const RENDER_COLUMNS =
  "id, engine, status, error, youcam_task_id, created_at, result:images!renders_result_image_id_fkey(path), hand:images!renders_hand_image_id_fkey(session_id, path, landmarks), design:designs(spec)";

async function view(row: RenderRow, cached = false): Promise<RenderView> {
  const { id, engine } = row;
  if (row.status === "success" && row.result) {
    return { id, engine, status: "success", resultUrl: await signedUrl(row.result.path), cached };
  }
  if (row.status === "error") return { id, engine, status: "error", error: row.error ?? "unknown_error" };
  return { id, engine, status: "running" };
}

export async function startRender(
  sessionId: string,
  handImageId: string,
  spec: DesignSpec,
  choice: EngineChoice = "auto",
): Promise<RenderView> {
  const db = supabaseAdmin();

  const { data: hand } = await db
    .from("images")
    .select("id, path, sha256, session_id, kind")
    .eq("id", handImageId)
    .maybeSingle();
  if (!hand || hand.kind !== "hand" || hand.session_id !== sessionId) {
    throw new RenderError("Hand photo not found", 404);
  }
  const engine = chooseEngine(spec, choice);
  // Transfer needs the inspiration photo; VTO needs every design finger's PNG.
  const ref = engine === "nail_transfer" ? await inspirationImage(sessionId, spec) : null;
  const designPaths = engine === "nail_vto" ? await designImagePaths(sessionId, spec) : {};

  // 1. Cache.
  const cacheKey = ref ? transferCacheKey(hand.sha256, ref.sha256) : renderCacheKey(spec, hand.sha256);
  const { data: hit } = await db.from("renders").select(RENDER_COLUMNS).eq("cache_key", cacheKey).maybeSingle<RenderRow>();
  if (hit && hit.status !== "error") return view(hit, true);
  if (hit) await db.from("renders").delete().eq("id", hit.id); // a failed render may be retried

  // Claim the cache key first: the unique constraint stops two identical requests both spending.
  const { data: design, error: designError } = await db
    .from("designs")
    .insert({ session_id: sessionId, spec, confidence: spec.confidence })
    .select("id")
    .single();
  if (designError) throw new Error(`Could not save design: ${designError.message}`);
  const { data: render, error: insertError } = await db
    .from("renders")
    .insert({ design_id: design.id, hand_image_id: hand.id, cache_key: cacheKey, engine, status: "pending" })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      const { data: racing } = await db.from("renders").select(RENDER_COLUMNS).eq("cache_key", cacheKey).single<RenderRow>();
      return view(racing!, true);
    }
    throw new Error(`Could not create render: ${insertError.message}`);
  }

  // 2. Unit ledger.
  const { data: reserved, error: reserveError } = await db.rpc("reserve_units", {
    p_session_id: sessionId,
    p_render_id: render.id,
    p_engine: engine,
    p_units: ENGINES[engine].units,
    p_session_cap: serverEnv("UNITS_SESSION_CAP"),
    p_global_cap: serverEnv("UNITS_GLOBAL_CAP"),
  });
  if (reserveError || !reserved) {
    await db.from("renders").delete().eq("id", render.id);
    throw reserveError
      ? new Error(`Could not reserve units: ${reserveError.message}`)
      : new RenderError("Try-on limit reached for this session", 429);
  }

  // 3. YouCam task, with short-lived signed URLs for the inputs.
  try {
    const handUrl = await signedUrl(hand.path);
    const payload = ref
      ? toTransferPayload(handUrl, await signedUrl(ref.path))
      : toNailVtoPayload(spec, handUrl, await signAll(designPaths));
    const taskId = await createTask(engine, payload);
    await db.from("renders").update({ status: "running", youcam_task_id: taskId }).eq("id", render.id);
    return { id: render.id, engine, status: "running" };
  } catch (error) {
    const message = error instanceof YouCamError ? (error.code ?? error.message) : String(error);
    await failRender(render.id, message);
    return { id: render.id, engine, status: "error", error: message };
  }
}

/** The spec's inspiration photo, which must be this session's own. */
async function inspirationImage(sessionId: string, spec: DesignSpec): Promise<{ path: string; sha256: string }> {
  const id = spec.source.imageId;
  if (!id) throw new RenderError("Nail Transfer needs the inspiration photo", 400);
  const { data } = await supabaseAdmin()
    .from("images")
    .select("path, sha256")
    .eq("id", id)
    .eq("session_id", sessionId)
    .eq("kind", "inspo")
    .maybeSingle();
  if (!data) throw new RenderError("Inspiration photo not found", 404);
  return data;
}

/** Storage paths of every design finger's PNG, keyed by image id. Each must be this session's own design image. */
async function designImagePaths(sessionId: string, spec: DesignSpec): Promise<Record<string, string>> {
  const ids = [...new Set(Object.values(spec.fingers).flatMap((f) => (f.designImageId ? [f.designImageId] : [])))];
  if (ids.length === 0) return {};
  const { data } = await supabaseAdmin()
    .from("images")
    .select("id, path")
    .in("id", ids)
    .eq("session_id", sessionId)
    .eq("kind", "design");
  if ((data ?? []).length !== ids.length) throw new RenderError("Design image not found", 404);
  return Object.fromEntries(data!.map((r) => [r.id, r.path]));
}

/** Short-lived signed URLs for YouCam, same keys. */
async function signAll(paths: Record<string, string>): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([id, path]) => [id, await signedUrl(path)])));
}

/** Marks a render failed and refunds its unit, exactly once (only the caller that flips the status refunds). */
async function failRender(renderId: string, error: string): Promise<void> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("renders")
    .update({ status: "error", error, completed_at: new Date().toISOString() })
    .eq("id", renderId)
    .in("status", ["pending", "running"])
    .select("id");
  if (data?.length) await db.rpc("refund_units", { p_render_id: renderId });
}

/** Current state of a render. While running, checks YouCam once (the browser polls this). */
export async function refreshRender(sessionId: string, renderId: string): Promise<RenderView> {
  const db = supabaseAdmin();
  const { data: row } = await db.from("renders").select(RENDER_COLUMNS).eq("id", renderId).maybeSingle<RenderRow>();
  if (!row || row.hand?.session_id !== sessionId) throw new RenderError("Render not found", 404);
  if (row.status !== "running" || !row.youcam_task_id) return view(row);

  // Ask YouCam before applying the timeout: a task that finished while nobody was
  // polling has already cost a unit and must still be collected.
  const { id, engine } = row;
  const state = await getTask(engine, row.youcam_task_id);
  if (state.status === "running") {
    if (Date.now() - new Date(row.created_at).getTime() > TASK_TIMEOUT_MS) {
      await failRender(id, "timeout");
      return { id, engine, status: "error", error: "timeout" };
    }
    return { id, engine, status: "running" };
  }
  if (state.status === "error") {
    await failRender(id, state.error);
    return { id, engine, status: "error", error: state.error };
  }

  // Success: copy the result out of YouCam before its URL expires. Safe to repeat if two polls race.
  const res = await fetch(state.resultUrl);
  if (!res.ok) throw new Error(`Could not download render result (${res.status})`);
  const raw = new Uint8Array(await res.arrayBuffer());
  const rawType = sniffImageType(raw);
  if (!rawType) throw new Error("Render result is not an image");
  const final = await trueColour(row, raw);
  if (final) await putObject(`renders/${row.id}-youcam.${rawType.ext}`, raw, rawType.contentType); // kept for comparison
  const bytes = final ?? raw;
  const type = final ? { ext: "jpg", contentType: "image/jpeg" } : rawType;
  const path = `renders/${row.id}.${type.ext}`;
  await putObject(path, bytes, type.contentType);
  const image = await upsertImage({ session_id: sessionId, kind: "render", path, sha256: sha256(bytes) });
  await db
    .from("renders")
    .update({ status: "success", result_image_id: image.id, completed_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "running");
  return { id, engine, status: "success", resultUrl: await signedUrl(path), cached: false };
}

/**
 * The true-colour composite of a finished render, or null to keep YouCam's own image
 * (Transfer, design fingers, nothing recoloured, or any failure: a paid render is never lost).
 */
async function trueColour(row: RenderRow, raw: Uint8Array): Promise<Uint8Array | null> {
  if (row.engine !== "nail_vto" || !row.design || !row.hand) return null;
  const targets = compositeTargets(row.design.spec, row.hand.landmarks);
  if (!targets) return null;
  try {
    const outcome = await compositeRender(await getObject(row.hand.path), raw, { targets });
    if (!outcome.ok) {
      console.info(`render ${row.id}: true-colour composite skipped (${outcome.reason})`);
      return null;
    }
    return outcome.bytes;
  } catch (error) {
    console.error(`render ${row.id}: true-colour composite failed`, error);
    return null;
  }
}
