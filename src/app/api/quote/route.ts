import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { loadCatalogue } from "@/lib/shade/catalogue";
import { matchSpec, quoteSpec } from "@/lib/shade/match";
import { designSpecSchema } from "@/lib/spec/types";

const bodySchema = z.object({
  spec: designSpecSchema,
  salon: z.string().regex(/^[a-z0-9-]{3,40}$/).optional(),
});

/**
 * The salon's polishes matched to each finger of a DesignSpec (CIEDE2000), plus a
 * price and chair-time quote. 0 YouCam units.
 */
export async function POST(request: Request) {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "Invalid quote request", issues: body.error.issues.slice(0, 5) }, { status: 400 });
  }

  try {
    const catalogue = await loadCatalogue(body.data.salon);
    if (!catalogue) return Response.json({ error: "Salon not found" }, { status: 404 });
    const { salon, polishes, rules } = catalogue;
    return Response.json({
      salon: { name: salon.name, city: salon.city, currency: salon.currency },
      matches: matchSpec(body.data.spec, polishes),
      quote: quoteSpec(body.data.spec, rules),
    });
  } catch (error) {
    return errorResponse(error, "POST /api/quote");
  }
}
