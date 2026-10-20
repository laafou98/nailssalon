import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

let client: SupabaseClient | undefined;

/**
 * Service-role Supabase client. Bypasses RLS, so it must only ever run on the server
 * (route handlers, server actions). Client sessions never talk to Postgres directly.
 */
export function supabaseAdmin(): SupabaseClient {
  client ??= createClient(serverEnv("NEXT_PUBLIC_SUPABASE_URL"), serverEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export const IMAGES_BUCKET = "images";
