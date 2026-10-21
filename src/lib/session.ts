import "server-only";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Anonymous client sessions. A client never signs in; an httpOnly cookie holds the
 * id of their `sessions` row, which scopes their uploads and their unit budget.
 */

const COOKIE = "ns_sid";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The caller's session id, or null if they have none (or it no longer exists). */
export async function currentSessionId(): Promise<string | null> {
  const id = (await cookies()).get(COOKIE)?.value;
  if (!id || !UUID.test(id)) return null;
  const { data } = await supabaseAdmin().from("sessions").select("id").eq("id", id).maybeSingle();
  return data?.id ?? null;
}

/** The caller's session id, creating the session (and cookie) if needed. Route handlers only. */
export async function ensureSessionId(): Promise<string> {
  const existing = await currentSessionId();
  if (existing) return existing;
  const { data, error } = await supabaseAdmin().from("sessions").insert({}).select("id").single();
  if (error) throw new Error(`Could not create session: ${error.message}`);
  (await cookies()).set(COOKIE, data.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE,
  });
  return data.id;
}
