import "server-only";
import { serverEnv } from "@/lib/env";
import { type DesignSpec, FINGERS } from "@/lib/spec/types";
import { renderCacheKey, toNailVtoPayload, toTransferPayload, transferCacheKey } from "@/lib/spec/payload";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getObject, putObject, sha256, signedUrl, upsertImage } from "@/lib/supabase/storage";
import { ENGINES, type TaskState, YouCamError, createTask, getTask } from "@/lib/youcam/client";
import { compositeTargets } from "./composite";
import { finishRender } from "./composite-image";
import { sniffImageType } from "./image-type";
import { fingerAxes, glossStrength } from "./realism";
import { type EngineChoice, type EngineName, chooseEngine } from "./router";

/**
 * Render [D]. The router picks the engine: Nail VTO renders the per-finger spec,
 * Nail Transfer copies the raw inspiration photo when the spec isn't trusted. One render = one YouCam unit, guarded three ways:
 *  1. cache: identical (hand photo, visible spec) requests reuse the first render;
 *  2. unit ledger: per-session and global caps, reserved atomically before the call;
 *  3. refunds: a render that fails gives its unit back (YouCam only charges successes).
 * Results are copied into our storage immediately (YouCam URLs expire after 2 h), then Nail VTO renders get the
 * post-passes: the true-colour composite for plain-colour specs (exact requested hue; composite.ts) and the realism
 * pass for every spec (photo grain, soft edge, cuticle shadow; realism.ts).
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

/**
 * Version of the post-passes. Bump it when composite.ts or realism.ts change the picture: finished renders made with
 * an older version are re-processed from YouCam's stored original the next time they're shown.
 */
export const POST_VERSION = 3;

/** Give up on a task YouCam hasn't finished after this long (observed: 7–10 s). */
const TASK_TIMEOUT_MS = 2 * 60_000;

interface RenderRow {
  id: string;
  design_id: string;
  engine: EngineName;
  status: "pending" | "running" | "success" | "error";
  error: string | null;
  youcam_task_id: string | null;
  created_at: string;
  post_version: number;
  result: { path: string } | null;
  hand: { session_id: string | null; path: string; landmarks: unknown } | null;
  design: { spec: DesignSpec } | null;
}

const RENDER_COLUMNS =
  "id, design_id, engine, status, error, youcam_task_id, created_at, post_version, result:images!renders_result_image_id_fkey(path), hand:images!renders_hand_image_id_fkey(session_id, path, landmarks), design:designs(spec)";

/** A render that has been pending or running longer than YouCam could possibly take. */
const isStale = (row: RenderRow) => Date.now() - new Date(row.created_at).getTime() > TASK_TIMEOUT_MS;

async function view(row: RenderRow, cached = false): Promise<RenderView> {
  const { id, engine } = row;
  if (row.status === "success" && row.result) {
    const path = await upgradeResult(row, row.result.path);
    return { id, engine, status: "success", resultUrl: await signedUrl(path), cached };
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

  // 1. Cache. Keyed by the hand row (one per session and photo), so a hit is always one this session can poll.
  const cacheKey = ref ? transferCacheKey(hand.id, ref.sha256) : renderCacheKey(spec, hand.id);
  const { data: hit } = await db.from("renders").select(RENDER_COLUMNS).eq("cache_key", cacheKey).maybeSingle<RenderRow>();
  if (hit) {
    const live = hit.status === "pending" || hit.status === "running";
    if (hit.status === "success" || (live && !isStale(hit))) return view(hit, true);
    if (live) {
      // Stuck for over two minutes: collect YouCam's answer if it has one, otherwise time it out (and refund).
      const settled = await advance(hit);
      if (settled.status === "success") return { ...settled, cached: true };
    }
    // A failed render may be retried: clear the key and its design.
    await db.from("renders").delete().eq("id", hit.id);
    await db.from("designs").delete().eq("id", hit.design_id);
  }

  // Claim the cache key first: the unique constraint stops two identical requests both spending.
  const { data: design, error: designError } = await db
    .from("designs")
    .insert({ session_id: sessionId, spec, confidence: spec.confidence })
    .select("id")
    .single();
  if (designError) throw new Error(`Could not save design: ${designError.message}`);
  const dropDesign = () => db.from("designs").delete().eq("id", design.id);
  const { data: render, error: insertError } = await db
    .from("renders")
    .insert({ design_id: design.id, hand_image_id: hand.id, cache_key: cacheKey, engine, status: "pending" })
    .select("id")
    .single();
  if (insertError) {
    await dropDesign();
    if (insertError.code === "23505") {
      const { data: racing } = await db.from("renders").select(RENDER_COLUMNS).eq("cache_key", cacheKey).maybeSingle<RenderRow>();
      if (!racing) throw new RenderError("Render not found", 404); // the other request gave up meanwhile: the client retries
      return view(racing, true);
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
    await dropDesign();
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
    const { error } = await db.from("renders").update({ status: "running", youcam_task_id: taskId }).eq("id", render.id);
    if (error) throw new Error(`Could not record the YouCam task: ${error.message}`);
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

/**
 * Marks a render failed, exactly once (only the caller that flips the status refunds). The unit is given back unless
 * YouCam charged for it: a result we could not collect (expired URL, storage failure) still cost one.
 */
async function failRender(renderId: string, error: string, { refund = true } = {}): Promise<void> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("renders")
    .update({ status: "error", error, completed_at: new Date().toISOString() })
    .eq("id", renderId)
    .in("status", ["pending", "running"])
    .select("id");
  if (data?.length && refund) await db.rpc("refund_units", { p_render_id: renderId });
}

/** Current state of a render. While running, checks YouCam once (the browser polls this). */
export async function refreshRender(sessionId: string, renderId: string): Promise<RenderView> {
  const db = supabaseAdmin();
  const { data: row } = await db.from("renders").select(RENDER_COLUMNS).eq("id", renderId).maybeSingle<RenderRow>();
  if (!row || row.hand?.session_id !== sessionId) throw new RenderError("Render not found", 404);
  return advance(row);
}

/**
 * Moves a live render along: asks YouCam, collects a finished result, or fails it once it is stale. A row never
 * stays pending or running for good, so its cache key and its unit are always freed in the end.
 */
async function advance(row: RenderRow): Promise<RenderView> {
  const db = supabaseAdmin();
  const { id, engine } = row;
  if (row.status === "success" || row.status === "error") return view(row);
  const fail = async (error: string, refund = true): Promise<RenderView> => {
    await failRender(id, error, { refund });
    return { id, engine, status: "error", error };
  };

  // Still pending: the task was never recorded (the server stopped between the insert and the YouCam call).
  if (!row.youcam_task_id) return isStale(row) ? fail("timeout") : { id, engine, status: "running" };

  // Ask YouCam before applying the timeout: a task that finished while nobody was
  // polling has already cost a unit and must still be collected.
  let state: TaskState;
  try {
    state = await getTask(engine, row.youcam_task_id);
  } catch (error) {
    // YouCam unreachable, or the task forgotten: keep waiting while young, give up once stale.
    if (!isStale(row)) throw error;
    return fail(error instanceof YouCamError && error.httpStatus === 404 ? "task_not_found" : "youcam_unreachable");
  }
  if (state.status === "running") return isStale(row) ? fail("timeout") : { id, engine, status: "running" };
  if (state.status === "error") return fail(state.error);

  // Success: copy the result out of YouCam before its URL expires. Safe to repeat if two polls race.
  const res = await fetch(state.resultUrl);
  // A result URL that no longer serves (they expire after 2 h) will never serve: the unit is spent, the row must not stay running.
  if (res.status >= 400 && res.status < 500) return fail(`result_expired (${res.status})`, false);
  if (!res.ok) throw new Error(`Could not download render result (${res.status})`);
  const raw = new Uint8Array(await res.arrayBuffer());
  const rawType = sniffImageType(raw);
  if (!rawType) return fail("result_not_an_image", false);
  // YouCam's original is always kept: the post-passes can be re-run on it when they improve (POST_VERSION).
  const rawPath = `renders/${row.id}-youcam.${rawType.ext}`;
  await putObject(rawPath, raw, rawType.contentType);
  const final = await finish(row, raw);
  const path = final ? finalPath(row.id) : rawPath;
  if (final) await putObject(path, final, "image/jpeg");
  const sessionId = row.hand?.session_id;
  if (!sessionId) throw new Error("Render has no owning session");
  const image = await upsertImage({ session_id: sessionId, kind: "render", path, sha256: sha256(final ?? raw) });
  await db
    .from("renders")
    .update({ status: "success", result_image_id: image.id, post_version: POST_VERSION, completed_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "running");
  return { id, engine, status: "success", resultUrl: await signedUrl(path), cached: false };
}

/** Where a render's post-processed result goes; versioned, so an upgrade never overwrites an earlier result. */
const finalPath = (renderId: string) => `renders/${renderId}-p${POST_VERSION}.jpg`;

/**
 * The result path to show for a finished render, after bringing a Nail VTO result made with older post-passes up to
 * POST_VERSION. YouCam's original is `renders/<id>-youcam.<ext>`; renders from before the post-passes have no such
 * copy, and their result is YouCam's original itself. Any failure keeps the stored result.
 */
async function upgradeResult(row: RenderRow, current: string): Promise<string> {
  if (row.engine !== "nail_vto" || row.post_version >= POST_VERSION || !row.hand?.session_id) return current;
  try {
    const raw = (await firstObject(["png", "jpg", "webp"].map((ext) => `renders/${row.id}-youcam.${ext}`))) ?? (await getObject(current));
    const final = await finish(row, raw);
    let path = current;
    const update: { post_version: number; result_image_id?: string } = { post_version: POST_VERSION };
    if (final) {
      path = finalPath(row.id);
      await putObject(path, final, "image/jpeg");
      update.result_image_id = (await upsertImage({ session_id: row.hand.session_id, kind: "render", path, sha256: sha256(final) })).id;
    }
    await supabaseAdmin().from("renders").update(update).eq("id", row.id).lt("post_version", POST_VERSION);
    return path;
  } catch (error) {
    console.error(`render ${row.id}: upgrade to post-passes v${POST_VERSION} failed`, error);
    return current;
  }
}

/** The first of these storage objects that exists, or null. */
async function firstObject(paths: string[]): Promise<Uint8Array | null> {
  for (const path of paths) {
    try {
      return await getObject(path);
    } catch {
      // not there: try the next
    }
  }
  return null;
}

/** Cuticle shadow strength: a press-on sits on top of the nail and casts one; polish barely does. */
const CUTICLE_SHADOW = { press_on_nails: 0.25, nail_polish: 0.12 } as const;

/**
 * A finished render after the post-passes (composite for plain colours, realism for all), or null to keep
 * YouCam's own image (Transfer, no nails found, or any failure: a paid render is never lost).
 */
async function finish(row: RenderRow, raw: Uint8Array): Promise<Uint8Array | null> {
  if (row.engine !== "nail_vto" || !row.design || !row.hand) return null;
  const { spec } = row.design;
  try {
    const outcome = await finishRender(await getObject(row.hand.path), raw, {
      targets: compositeTargets(spec, row.hand.landmarks),
      fingers: fingerAxes(row.hand.landmarks),
      shadow: CUTICLE_SHADOW[spec.effectType],
      gloss: glossStrength(FINGERS.map((f) => spec.fingers[f])),
    });
    if (!outcome.ok) {
      console.info(`render ${row.id}: post-passes skipped (${outcome.reason})`);
      return null;
    }
    return outcome.bytes;
  } catch (error) {
    console.error(`render ${row.id}: post-passes failed`, error);
    return null;
  }
}
