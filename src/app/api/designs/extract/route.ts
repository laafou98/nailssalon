import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { MAX_CROP_BYTES, parseJpegUpload } from "@/lib/render/design-upload";
import { currentSessionId } from "@/lib/session";
import { FINGERS } from "@/lib/spec/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getObject } from "@/lib/supabase/storage";
import { readDesign } from "@/lib/vision/deepseek";
import type { CropInput } from "@/lib/vision/reading";

const dataUrl = (bytes: Uint8Array) => `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;

/**
 * Design Compiler [C], semantics: the stored inspiration photo plus one crop per
 * tapped nail → finish, pattern, shape and length per the vision model.
 * Body: multipart form with `inspoImageId` and `crop_<finger>` JPEGs (fingers
 * that weren't tapped are left out). Returns a DesignReading. No YouCam units.
 */
export async function POST(request: Request) {
  const sessionId = await currentSessionId();
  if (!sessionId) return Response.json({ error: "Upload a hand photo first" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected a multipart form" }, { status: 400 });
  }
  const inspoId = z.uuid().safeParse(form.get("inspoImageId"));
  if (!inspoId.success) return Response.json({ error: "Missing inspoImageId" }, { status: 400 });

  const crops: CropInput[] = [];
  for (const finger of FINGERS) {
    const entry = form.get(`crop_${finger}`);
    if (entry === null) continue;
    const crop = await parseJpegUpload(entry, MAX_CROP_BYTES, 32);
    if (!crop.ok) return Response.json({ error: `${finger} crop: ${crop.error}` }, { status: 400 });
    crops.push({ finger, url: dataUrl(crop.bytes) });
  }

  try {
    const { data: inspo } = await supabaseAdmin()
      .from("images")
      .select("path")
      .eq("id", inspoId.data)
      .eq("session_id", sessionId)
      .eq("kind", "inspo")
      .maybeSingle();
    if (!inspo) return Response.json({ error: "Inspiration photo not found" }, { status: 404 });
    const reading = await readDesign(dataUrl(await getObject(inspo.path)), crops);
    return Response.json(reading);
  } catch (error) {
    return errorResponse(error, "POST /api/designs/extract");
  }
}
