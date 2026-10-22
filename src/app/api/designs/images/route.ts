import { errorResponse } from "@/lib/api";
import { parseDesignUpload } from "@/lib/render/design-upload";
import { currentSessionId } from "@/lib/session";
import { putObject, sha256, upsertImage } from "@/lib/supabase/storage";

/**
 * Stores one finger's design PNG (cut out of an inspiration photo in the browser).
 * Body: multipart form with `design` (PNG). Returns `{ imageId }` for the spec's
 * `designImageId`. Content-addressed: the same cut-out is stored once, so the
 * render cache still hits. Spends no YouCam units.
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
  const upload = await parseDesignUpload(form);
  if (!upload.ok) return Response.json({ error: upload.error }, { status: 400 });

  try {
    const hash = sha256(upload.bytes);
    const path = `designs/${hash}.png`;
    await putObject(path, upload.bytes, "image/png");
    const image = await upsertImage({
      session_id: sessionId,
      kind: "design",
      path,
      sha256: hash,
      width: upload.width,
      height: upload.height,
    });
    return Response.json({ imageId: image.id }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "POST /api/designs/images");
  }
}
