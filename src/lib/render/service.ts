import "server-only";
import { serverEnv } from "@/lib/env";
import { type DesignSpec } from "@/lib/spec/types";
import { renderCacheKey, toNailVtoPayload } from "@/lib/spec/payload";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { putObject, sha256, signedUrl, upsertImage } from "@/lib/supabase/storage";
import { ENGINES, YouCamError, createTask, getTask } from "@/lib/youcam/client";

/**
 * Render [D], Nail VTO path. One render = one YouCam unit, guarded three ways:
 *  1. cache: identical (hand photo, visible spec) requests reuse the first render;
 *  2. unit ledger: per-session and global caps, reserved atomically before the call;
 *  3. refunds: a render that fails gives its unit back (YouCam only charges successes).
 * Results are copied into our storage immediately (YouCam URLs expire after 2 h).
 */

export type RenderView =
  | { id: string; status: "running" }
  | { id: string; status: "success"; resultUrl: string; cached: boolean }
  | { id: string; status: "error"; error: string };

export class RenderError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
  }
}

const ENGINE = "nail_vto" as const;
/** Give up on a task YouCam hasn't finished after this long (observed: 7–10 s). */
const TASK_TIMEOUT_MS = 2 * 60_000;

interface RenderRow {
  id: string;
  status: "pending" | "running" | "success" | "error";
  error: string | null;
  youcam_task_id: string | null;
  created_at: string;
  result: { path: string } | null;
  hand: { session_id: string | null } | null;
}

const RENDER_COLUMNS =
  "id, status, error, youcam_task_id, created_at, result:images!renders_result_image_id_fkey(path), hand:images!renders_hand_image_id_fkey(session_id)";

async function view(row: RenderRow, cached = false): Promise<RenderView> {
  if (row.status === "success" && row.result) {
    return { id: row.id, status: "success", resultUrl: await signedUrl(row.result.path), cached };
  }
  if (row.status === "error") return { id: row.id, status: "error", error: row.error ?? "unknown_error" };
  return { id: row.id, status: "running" };
}

export async function startRender(sessionId: string, handImageId: string, spec: DesignSpec): Promise<RenderView> {
  const db = supabaseAdmin();

  const { data: hand } = await db
    .from("images")
    .select("id, path, sha256, session_id, kind")
    .eq("id", handImageId)
    .maybeSingle();
  if (!hand || hand.kind !== "hand" || hand.session_id !== sessionId) {
    throw new RenderError("Hand photo not found", 404);
  }

  // 1. Cache.
  const cacheKey = renderCacheKey(spec, hand.sha256);
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
    .insert({ design_id: design.id, hand_image_id: hand.id, cache_key: cacheKey, engine: ENGINE, status: "pending" })
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
    p_engine: ENGINE,
    p_units: ENGINES[ENGINE].units,
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
    const payload = toNailVtoPayload(spec, await signedUrl(hand.path), await designUrls(spec));
    const taskId = await createTask(ENGINE, payload);
    await db.from("renders").update({ status: "running", youcam_task_id: taskId }).eq("id", render.id);
    return { id: render.id, status: "running" };
  } catch (error) {
    const message = error instanceof YouCamError ? (error.code ?? error.message) : String(error);
    await failRender(render.id, message);
    return { id: render.id, status: "error", error: message };
  }
}

/** Signed URLs for every design finger's PNG, keyed by image id. */
async function designUrls(spec: DesignSpec): Promise<Record<string, string>> {
  const ids = [...new Set(Object.values(spec.fingers).flatMap((f) => (f.designImageId ? [f.designImageId] : [])))];
  if (ids.length === 0) return {};
  const { data } = await supabaseAdmin().from("images").select("id, path").in("id", ids);
  return Object.fromEntries(await Promise.all((data ?? []).map(async (r) => [r.id, await signedUrl(r.path)])));
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

  if (Date.now() - new Date(row.created_at).getTime() > TASK_TIMEOUT_MS) {
    await failRender(row.id, "timeout");
    return { id: row.id, status: "error", error: "timeout" };
  }

  const state = await getTask(ENGINE, row.youcam_task_id);
  if (state.status === "running") return { id: row.id, status: "running" };
  if (state.status === "error") {
    await failRender(row.id, state.error);
    return { id: row.id, status: "error", error: state.error };
  }

  // Success: copy the result out of YouCam before its URL expires. Safe to repeat if two polls race.
  const res = await fetch(state.resultUrl);
  if (!res.ok) throw new Error(`Could not download render result (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const contentType = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  const path = `renders/${row.id}.${contentType === "image/png" ? "png" : "jpg"}`;
  await putObject(path, bytes, contentType);
  const image = await upsertImage({ session_id: sessionId, kind: "render", path, sha256: sha256(bytes) });
  await db
    .from("renders")
    .update({ status: "success", result_image_id: image.id, completed_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "running");
  return { id: row.id, status: "success", resultUrl: await signedUrl(path), cached: false };
}
