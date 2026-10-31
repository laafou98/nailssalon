import "server-only";
import { RenderError } from "@/lib/render/service";
import type { EngineName } from "@/lib/render/router";
import { loadCatalogue } from "@/lib/shade/catalogue";
import { matchSpec, quoteSpec, type FingerMatch, type Quote } from "@/lib/shade/match";
import type { DesignSpec, Finger } from "@/lib/spec/types";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Recipe cards: a finished render frozen with its polish matches and quote, readable by
 * anyone with the link (/r/<id>) so the client can send it to the salon on WhatsApp.
 */

export interface Recipe {
  id: string;
  createdAt: string;
  salon: { name: string; city: string | null; currency: string };
  spec: DesignSpec;
  engine: EngineName;
  /** Storage path of the rendered hand. */
  imagePath: string;
  matches: Record<Finger, FingerMatch>;
  quote: Quote;
}

/** The recipe for a finished render of the caller's, created on first request. */
export async function createRecipe(sessionId: string, renderId: string): Promise<string> {
  const db = supabaseAdmin();
  const { data: render } = await db
    .from("renders")
    .select("id, status, design_id, hand:images!renders_hand_image_id_fkey(session_id), design:designs(spec)")
    .eq("id", renderId)
    .maybeSingle<{ id: string; status: string; design_id: string; hand: { session_id: string } | null; design: { spec: DesignSpec } | null }>();
  if (!render || render.hand?.session_id !== sessionId) throw new RenderError("Render not found", 404);
  if (render.status !== "success" || !render.design) throw new RenderError("The render isn't finished", 409);

  const existing = await db.from("recipes").select("id").eq("render_id", renderId).limit(1).maybeSingle();
  if (existing.data) return existing.data.id;

  const catalogue = await loadCatalogue();
  if (!catalogue) throw new Error("Salon catalogue missing");
  const matches = matchSpec(render.design.spec, catalogue.polishes);
  if (!matches) throw new RenderError("The salon has no polishes in stock", 409);

  const { data, error } = await db
    .from("recipes")
    .insert({
      design_id: render.design_id,
      render_id: renderId,
      salon_id: catalogue.salon.id,
      polish_matches: matches,
      quote: quoteSpec(render.design.spec, catalogue.rules),
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not save recipe: ${error.message}`);
  return data.id;
}

export async function loadRecipe(id: string): Promise<Recipe | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await supabaseAdmin()
    .from("recipes")
    .select(
      "id, created_at, quote, polish_matches, salon:salons(name, city, currency), design:designs(spec), render:renders(engine, result:images!renders_result_image_id_fkey(path))",
    )
    .eq("id", id)
    .maybeSingle<{
      id: string;
      created_at: string;
      quote: Quote;
      polish_matches: Record<Finger, FingerMatch>;
      salon: Recipe["salon"] | null;
      design: { spec: DesignSpec } | null;
      render: { engine: EngineName; result: { path: string } | null } | null;
    }>();
  if (!data?.salon || !data.design || !data.render?.result) return null;
  return {
    id: data.id,
    createdAt: data.created_at,
    salon: data.salon,
    spec: data.design.spec,
    engine: data.render.engine,
    imagePath: data.render.result.path,
    matches: data.polish_matches,
    quote: data.quote,
  };
}
