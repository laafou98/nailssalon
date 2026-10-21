import "server-only";
import { createHash } from "node:crypto";
import { IMAGES_BUCKET, supabaseAdmin } from "@/lib/supabase/admin";

/** Signed URLs are handed to YouCam and to the browser; an hour covers a render comfortably. */
export const SIGNED_URL_SECONDS = 60 * 60;

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Upload to the private bucket. Content-addressed paths make a repeat upload a no-op. */
export async function putObject(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .storage.from(IMAGES_BUCKET)
    .upload(path, bytes, { contentType, upsert: true, cacheControl: "31536000" });
  if (error) throw new Error(`Storage upload failed for ${path}: ${error.message}`);
}

export async function signedUrl(path: string): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .storage.from(IMAGES_BUCKET)
    .createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error) throw new Error(`Could not sign ${path}: ${error.message}`);
  return data.signedUrl;
}

export interface ImageRow {
  id: string;
  session_id: string | null;
  path: string;
  sha256: string;
}

/** Insert an images row, or return the existing one for the same session, kind and content. */
export async function upsertImage(row: {
  session_id: string;
  kind: "hand" | "inspo" | "design" | "render" | "after";
  path: string;
  sha256: string;
  width?: number;
  height?: number;
  landmarks?: unknown;
}): Promise<ImageRow> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("images")
    .upsert(row, { onConflict: "session_id,kind,sha256", ignoreDuplicates: true })
    .select("id, session_id, path, sha256")
    .maybeSingle();
  if (error) throw new Error(`Could not save image: ${error.message}`);
  if (data) return data;
  // Duplicate: ignoreDuplicates returns nothing, so read the existing row.
  const existing = await db
    .from("images")
    .select("id, session_id, path, sha256")
    .eq("session_id", row.session_id)
    .eq("kind", row.kind)
    .eq("sha256", row.sha256)
    .single();
  if (existing.error) throw new Error(`Could not read image: ${existing.error.message}`);
  return existing.data;
}
