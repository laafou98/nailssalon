import "server-only";
import { z } from "zod";

const serverSchema = z.object({
  YOUCAM_API_KEY: z.string().min(1, "YOUCAM_API_KEY is not set"),
  DEEPSEEK_API_KEY: z.string().min(1, "DEEPSEEK_API_KEY is not set"),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1, "SUPABASE_SECRET_KEY is not set"),
  UNITS_SESSION_CAP: z.coerce.number().int().positive().default(15),
  UNITS_GLOBAL_CAP: z.coerce.number().int().positive().default(900),
});

type ServerEnv = z.infer<typeof serverSchema>;

/**
 * Read one server-side variable, validated. Parsing per key (rather than the whole
 * object up front) lets features fail independently while keys are still being added.
 */
export function serverEnv<K extends keyof ServerEnv>(key: K): ServerEnv[K] {
  const field = serverSchema.shape[key];
  const result = field.safeParse(process.env[key]);
  if (!result.success) {
    throw new Error(`Invalid environment variable ${key}: ${result.error.issues[0]?.message}`);
  }
  return result.data as ServerEnv[K];
}
