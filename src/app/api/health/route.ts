import { connection } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Deployment check: confirms the database is reachable and which server keys are set.
 * Never spends YouCam units and never returns key values.
 */
export async function GET() {
  await connection();

  const keys = {
    youcam: Boolean(process.env.YOUCAM_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    supabaseSecret: Boolean(process.env.SUPABASE_SECRET_KEY),
  };

  let database: "ok" | "error" = "error";
  let unitsSpent: number | null = null;
  if (keys.supabaseSecret) {
    const { data, error } = await supabaseAdmin().from("unit_ledger").select("units");
    if (!error) {
      database = "ok";
      unitsSpent = data.reduce((sum, row) => sum + row.units, 0);
    }
  }

  const healthy = database === "ok" && keys.youcam;
  return Response.json({ healthy, database, keys, unitsSpent }, { status: healthy ? 200 : 503 });
}
