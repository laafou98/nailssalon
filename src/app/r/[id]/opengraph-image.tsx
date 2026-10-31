import { ImageResponse } from "next/og";
import { connection } from "next/server";
import { fingerList, groupFingers, money, serviceLabel } from "@/lib/recipe/format";
import { loadRecipe } from "@/lib/recipe/service";
import { sniffImageType } from "@/lib/render/image-type";
import { getObject } from "@/lib/supabase/storage";

/** The link preview WhatsApp shows: the hand on the left, the polishes and price on the right. */

export const alt = "Nail recipe: the design on the client's hand, the salon's polishes and the price";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const recipe = await loadRecipe((await params).id);
  if (!recipe) {
    return new ImageResponse(<Frame><div style={{ fontSize: 48, margin: "auto" }}>NailsSalon</div></Frame>, size);
  }

  const bytes = await getObject(recipe.imagePath).catch(() => null);
  const type = bytes && sniffImageType(bytes);
  // Satori draws PNG and JPEG only.
  const photo = bytes && type && type.ext !== "webp" ? `data:${type.contentType};base64,${Buffer.from(bytes).toString("base64")}` : null;
  const groups = groupFingers(recipe.matches).slice(0, 5);

  return new ImageResponse(
    (
      <Frame>
        {photo ? (
          <img src={photo} alt="" width={630} height={630} style={{ objectFit: "cover", objectPosition: "top" }} />
        ) : (
          <div style={{ width: 630, height: 630, background: "#27272a" }} />
        )}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "48px 44px", gap: 18 }}>
          <div style={{ fontSize: 22, color: "#a1a1aa", letterSpacing: 2 }}>{`NAIL RECIPE · ${recipe.salon.name.toUpperCase()}`}</div>
          <div style={{ fontSize: 38, fontWeight: 700, lineHeight: 1.15 }}>{serviceLabel(recipe.spec)}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
            {groups.map(({ fingers, match }) => (
              <div key={fingers.join()} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ width: 40, height: 40, borderRadius: 20, background: match.base.polish.hex, border: "2px solid #3f3f46" }} />
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div style={{ fontSize: 24 }}>{`${match.base.polish.name}${match.base.topCoat ? ` + ${match.base.topCoat}` : ""}${match.accents.length ? ` + ${match.accents.length} art` : ""}`}</div>
                  <div style={{ fontSize: 18, color: "#a1a1aa" }}>{fingerList(fingers)}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", marginTop: "auto", fontSize: 34, fontWeight: 700 }}>
            {money(recipe.quote.total, recipe.salon.currency)}
            <span style={{ fontSize: 24, fontWeight: 400, color: "#a1a1aa", marginLeft: 16, alignSelf: "flex-end" }}>
              {`about ${recipe.quote.minutes} min`}
            </span>
          </div>
        </div>
      </Frame>
    ),
    size,
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", width: "100%", height: "100%", background: "#09090b", color: "#fafafa" }}>{children}</div>
  );
}
