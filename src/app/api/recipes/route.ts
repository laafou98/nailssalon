import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { recipeMessage, whatsappLink } from "@/lib/recipe/format";
import { createRecipe, loadRecipe } from "@/lib/recipe/service";
import { currentSessionId } from "@/lib/session";

const bodySchema = z.object({ renderId: z.uuid() });

/**
 * Freezes a finished render into a shareable recipe card. Returns its public URL and a
 * WhatsApp link with the message pre-filled (the client picks the contact).
 */
export async function POST(request: Request) {
  const sessionId = await currentSessionId();
  if (!sessionId) return Response.json({ error: "Upload a hand photo first" }, { status: 401 });

  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid recipe request" }, { status: 400 });

  try {
    const id = await createRecipe(sessionId, body.data.renderId);
    const recipe = await loadRecipe(id);
    if (!recipe) throw new Error(`Recipe ${id} not readable after creation`);
    const url = `${new URL(request.url).origin}/r/${id}`;
    const text = recipeMessage({
      salonName: recipe.salon.name,
      currency: recipe.salon.currency,
      spec: recipe.spec,
      matches: recipe.matches,
      quote: recipe.quote,
      url,
    });
    return Response.json({ id, url, whatsapp: whatsappLink(text) });
  } catch (error) {
    return errorResponse(error, "POST /api/recipes");
  }
}
