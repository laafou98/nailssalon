import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { currentSessionId } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getObject } from "@/lib/supabase/storage";
import { locateNails } from "@/lib/vision/claude";

/**
 * Automatic nail detection: the stored inspiration photo → every visible nail's
 * finger, hand and centre (fractions of the photo), from the vision model.
 * Body: JSON `{ inspoImageId }`. No YouCam units.
 */
export async function POST(request: Request) {
  const sessionId = await currentSessionId();
  if (!sessionId) return Response.json({ error: "Upload a hand photo first" }, { status: 401 });
  const body = z.object({ inspoImageId: z.uuid() }).safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Missing inspoImageId" }, { status: 400 });

  try {
    const { data: inspo } = await supabaseAdmin()
      .from("images")
      .select("path, width, height")
      .eq("id", body.data.inspoImageId)
      .eq("session_id", sessionId)
      .eq("kind", "inspo")
      .maybeSingle();
    if (!inspo || !inspo.width || !inspo.height) return Response.json({ error: "Inspiration photo not found" }, { status: 404 });
    const photo = Buffer.from(await getObject(inspo.path)).toString("base64");
    try {
      return Response.json(await locateNails(photo, inspo.width, inspo.height));
    } catch (error) {
      // The vision model's own failure: pass the reason on so a phone test shows it (no secrets in these messages).
      console.error("[POST /api/designs/locate]", error);
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
    }
  } catch (error) {
    return errorResponse(error, "POST /api/designs/locate");
  }
}
