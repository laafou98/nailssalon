import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Texture } from "@/lib/spec/types";
import type { Polish, PriceRules } from "./match";

/** The salon whose catalogue the client sees. One demo salon until salon links (/s/<slug>) exist. */
export const DEFAULT_SALON = "demo";

export interface SalonCatalogue {
  salon: { id: string; name: string; city: string | null; currency: string; whatsapp: string | null };
  polishes: Polish[];
  rules: PriceRules;
}

export async function loadCatalogue(slug = DEFAULT_SALON): Promise<SalonCatalogue | null> {
  const db = supabaseAdmin();
  const { data: salon, error } = await db
    .from("salons")
    .select("id, name, city, currency, whatsapp")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!salon) return null;

  const [polishes, rules] = await Promise.all([
    db.from("polishes").select("id, brand, name, hex, lab_l, lab_a, lab_b, finish").eq("salon_id", salon.id).eq("in_stock", true),
    db.from("price_rules").select("base_price, art_tiers, length_surcharge, minutes").eq("salon_id", salon.id).maybeSingle(),
  ]);
  if (polishes.error) throw polishes.error;
  if (rules.error) throw rules.error;

  return {
    salon,
    polishes: polishes.data.map((p) => ({
      id: p.id,
      brand: p.brand,
      name: p.name,
      hex: p.hex.toUpperCase(),
      lab: { L: p.lab_l, a: p.lab_a, b: p.lab_b },
      finish: p.finish as Texture,
    })),
    rules: {
      basePrice: Number(rules.data?.base_price ?? 0),
      artTiers: (rules.data?.art_tiers ?? {}) as Record<string, number>,
      lengthSurcharge: Number(rules.data?.length_surcharge ?? 0),
      minutes: (rules.data?.minutes ?? {}) as PriceRules["minutes"],
    },
  };
}
