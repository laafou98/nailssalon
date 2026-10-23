import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { ENGINE_NAMES } from "@/lib/render/router";
import { startRender } from "@/lib/render/service";
import { currentSessionId } from "@/lib/session";
import { designSpecSchema } from "@/lib/spec/types";

const bodySchema = z.object({
  handImageId: z.uuid(),
  spec: designSpecSchema,
  /** Force an engine; by default the router decides from the spec's confidence. */
  engine: z.enum([...ENGINE_NAMES, "auto"]).default("auto"),
});

/**
 * Starts a try-on render of a DesignSpec on an uploaded hand photo.
 * Returns the cached result when the same render already exists (no unit spent),
 * otherwise `{ id, engine, status: "running" }`; poll GET /api/renders/:id for the result.
 */
export async function POST(request: Request) {
  const sessionId = await currentSessionId();
  if (!sessionId) return Response.json({ error: "Upload a hand photo first" }, { status: 401 });

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "Invalid render request", issues: body.error.issues.slice(0, 5) }, { status: 400 });
  }

  try {
    const render = await startRender(sessionId, body.data.handImageId, body.data.spec, body.data.engine);
    return Response.json(render, { status: render.status === "running" ? 202 : 200 });
  } catch (error) {
    return errorResponse(error, "POST /api/renders");
  }
}
