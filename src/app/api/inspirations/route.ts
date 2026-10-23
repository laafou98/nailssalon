import { errorResponse } from "@/lib/api";
import { MAX_INSPO_BYTES, parseJpegUpload } from "@/lib/render/design-upload";
import { currentSessionId } from "@/lib/session";
import { putObject, sha256, upsertImage } from "@/lib/supabase/storage";

/**
 * Stores the client's inspiration photo (JPEG, re-encoded in the browser).
 * It feeds the vision model and is Nail Transfer's reference image.
 * Body: multipart form with `photo`. Returns `{ imageId }` for the spec's `source.imageId`.
 * Content-addressed; spends no YouCam units.
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
  const upload = await parseJpegUpload(form.get("photo"), MAX_INSPO_BYTES, 256);
  if (!upload.ok) return Response.json({ error: upload.error }, { status: 400 });

  try {
    const hash = sha256(upload.bytes);
    const path = `inspo/${hash}.jpg`;
    await putObject(path, upload.bytes, "image/jpeg");
    const image = await upsertImage({ session_id: sessionId, kind: "inspo", path, sha256: hash, width: upload.width, height: upload.height });
    return Response.json({ imageId: image.id }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "POST /api/inspirations");
  }
}
