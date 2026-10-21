import { errorResponse } from "@/lib/api";
import { parseHandUpload } from "@/lib/hand-gate/upload";
import { ensureSessionId } from "@/lib/session";
import { putObject, sha256, signedUrl, upsertImage } from "@/lib/supabase/storage";

/**
 * Stores a hand photo that passed the browser's Hand Quality Gate.
 * Body: multipart form with `photo` (JPEG), `width`, `height`, `landmarks` (JSON).
 * Content-addressed: the same photo is stored once. Spends no YouCam units.
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected a multipart form" }, { status: 400 });
  }
  const upload = await parseHandUpload(form);
  if (!upload.ok) return Response.json({ error: upload.error }, { status: 400 });

  try {
    const sessionId = await ensureSessionId();
    const hash = sha256(upload.bytes);
    const path = `hands/${hash}.jpg`;
    await putObject(path, upload.bytes, "image/jpeg");
    const image = await upsertImage({
      session_id: sessionId,
      kind: "hand",
      path,
      sha256: hash,
      width: upload.meta.width,
      height: upload.meta.height,
      landmarks: upload.meta.landmarks,
    });
    return Response.json({ imageId: image.id, url: await signedUrl(path) }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "POST /api/hands");
  }
}
