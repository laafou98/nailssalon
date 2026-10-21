import { connection } from "next/server";
import { RenderError, refreshRender } from "@/lib/render/service";
import { currentSessionId } from "@/lib/session";

/** Render status; the browser polls this every ~2 s while a render is running. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  const sessionId = await currentSessionId();
  if (!sessionId) return Response.json({ error: "Render not found" }, { status: 404 });

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Render not found" }, { status: 404 });

  try {
    return Response.json(await refreshRender(sessionId, id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RenderError) return Response.json({ error: error.message }, { status: error.httpStatus });
    throw error;
  }
}
