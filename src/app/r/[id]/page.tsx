import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import Icon from "@/components/ui/Icon";
import { FINGER_LABEL, FINISH_LABEL, durationLabel, lengthLabel, money, serviceLabel } from "@/lib/recipe/format";
import { loadRecipe as load } from "@/lib/recipe/service";
import { FINGERS, type Finger, type FingerSpec } from "@/lib/spec/types";
import { signedUrl } from "@/lib/supabase/storage";

/** The shareable recipe card: what to ask the salon for, on the client's own hand. */

const loadRecipe = cache(load);

export async function generateMetadata({ params }: PageProps<"/r/[id]">): Promise<Metadata> {
  const recipe = await loadRecipe((await params).id);
  if (!recipe) return { title: "Recipe not found · NailsSalon" };
  const title = `Nail recipe for ${recipe.salon.name}`;
  const description = `${serviceLabel(recipe.spec)} · ${money(recipe.quote.total, recipe.salon.currency)}, about ${recipe.quote.minutes} min`;
  return { title, description, openGraph: { title, description } };
}

export default function RecipePage({ params }: PageProps<"/r/[id]">) {
  return (
    <main className="n-scr n-recipe">
      <Suspense fallback={<p className="n-note">Loading the recipe…</p>}>
        {params.then(({ id }) => <Recipe id={id} />)}
      </Suspense>
    </main>
  );
}

const FINGER_LETTER = (f: Finger) => f[0].toUpperCase();

async function Recipe({ id }: { id: string }) {
  const recipe = await loadRecipe(id);
  if (!recipe) notFound();
  const { salon, spec, matches, quote } = recipe;
  const image = await signedUrl(recipe.imagePath).catch(() => null);
  const pressOn = spec.effectType === "press_on_nails";
  const tip = spec.shape?.split("_")[0];
  const chips = pressOn
    ? [tip && tip.charAt(0).toUpperCase() + tip.slice(1), spec.length !== undefined && lengthLabel(spec.length), "Extensions"].filter(Boolean)
    : ["Natural length", "Gel"];
  const date = new Date(recipe.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <>
      <div className="n-hero">
        <div className="n-brand">
          <div className="n-d n-logo">
            NAILS
            <br />
            SALON!
          </div>
          <span className="n-eye n-tag">Recipe · {id.slice(0, 4).toUpperCase()}</span>
        </div>
        <h1 className="n-d">
          Five nails,
          <br />
          <em>one recipe.</em>
        </h1>
        <div className="n-fan" role="img" aria-label={`The five nails: ${FINGERS.map((f) => `${FINGER_LABEL[f].toLowerCase()} ${spec.fingers[f].baseHex}`).join(", ")}`}>
          {FINGERS.map((f) => (
            <div key={f} className="n-n">
              <NailSketch id={f} finger={spec.fingers[f]} />
              <span>{FINGER_LETTER(f)}</span>
            </div>
          ))}
        </div>
        <div className="n-spec">
          {chips.map((c) => <b key={String(c)}>{c}</b>)}
        </div>
        <p className="n-eye n-for">For {salon.name}{salon.city ? `, ${salon.city}` : ""} · {date}</p>
      </div>

      <section className="n-sec n-sec-tight">
        <h2 className="n-d">Nail by nail</h2>
        <div className="n-rows">
          {FINGERS.map((f) => {
            const finger = spec.fingers[f];
            const m = matches[f];
            const pattern = finger.kind === "design" ? (finger.pattern === "solid" ? "nail art" : finger.pattern.replace("_", " ")) : finger.pattern === "solid" ? null : finger.pattern.replace("_", " ");
            const finish = FINISH_LABEL[finger.texture];
            return (
              <div key={f} className="n-rrow">
                <span className="f">{FINGER_LETTER(f)}</span>
                <div>
                  <b>{m.base.polish.name} · {finish.charAt(0).toUpperCase() + finish.slice(1)}</b>
                  <small>
                    {m.base.polish.brand}
                    {m.base.topCoat && ` + ${m.base.topCoat}`}
                    {pattern && ` · ${pattern}`}
                    {m.accents.length > 0 && ` · art: ${m.accents.map((a) => `${a.polish.brand} ${a.polish.name}`).join(", ")}`}
                  </small>
                  <small>{m.base.polish.hex} · ΔE {m.base.deltaE.toFixed(1)} from the design, {m.base.label}</small>
                </div>
                <i style={{ backgroundColor: m.base.polish.hex }} />
              </div>
            );
          })}
        </div>
      </section>

      <div className="n-tot">
        <b className="n-d">{money(quote.total, salon.currency)}</b>
        <p>
          <strong>About {durationLabel(quote.minutes)}</strong>
          <br />
          {serviceLabel(spec)}
        </p>
      </div>
      <div className="n-gutter" style={{ marginTop: 14 }}>
        <div className="n-lines" style={{ borderTop: 0, marginTop: 0, color: "var(--mute)", paddingTop: 0 }}>
          {quote.lines.map((l) => (
            <div key={l.label}>
              <span>{l.label}</span>
              <span>{money(l.amount, salon.currency)}</span>
            </div>
          ))}
        </div>
        <p className="n-cap" style={{ marginTop: 10 }}>An estimate from the salon&apos;s price list; the technician confirms it at the appointment.</p>
      </div>

      <div className="n-foot">
        <details className="n-reveal">
          <summary className="n-btn n-btn-soft">
            <Icon name="photo" size={20} />
            See it on the client&apos;s hand
          </summary>
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
            <img src={image} alt="The design on the client's hand" className="n-sticker" />
          ) : (
            <p className="n-note n-note-err">The photo couldn&apos;t be loaded right now. Try again in a moment.</p>
          )}
          {recipe.engine === "nail_transfer" && (
            <p className="n-cap" style={{ marginTop: 14 }}>Approximate preview: copied from the inspiration photo as a whole, so check which finger carries which design.</p>
          )}
        </details>
        <p className="n-made">
          Made with <Link href="/">NailsSalon</Link> · try your own design
        </p>
      </div>
    </>
  );
}

const NAIL = "M29 3 C47 14 54 36 54 54 V80 Q29 94 4 80 V54 C4 36 11 14 29 3Z";

/** A sketch of one nail from its spec: the real colours and pattern type. The actual art is on the hand photo. */
function NailSketch({ id, finger }: { id: string; finger: FingerSpec }) {
  const accent = finger.accentHexes[0];
  const clip = `n-nail-${id}`;
  return (
    <svg viewBox="0 0 58 96" aria-hidden>
      <defs>
        <clipPath id={clip}><path d={NAIL} /></clipPath>
        {finger.pattern === "ombre" && accent && (
          <linearGradient id={`${clip}-o`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={accent} />
            <stop offset="1" stopColor={finger.baseHex} />
          </linearGradient>
        )}
      </defs>
      <path d="M33 7 C51 18 58 40 58 58 V84 Q33 98 8 84 V58 C8 40 15 18 33 7Z" fill="#141210" />
      <path d={NAIL} fill={finger.pattern === "ombre" && accent ? `url(#${clip}-o)` : finger.baseHex} />
      <g clipPath={`url(#${clip})`}>
        {finger.pattern === "french" && <path d="M0 34 Q29 46 58 34 V0 H0Z" fill={accent ?? "#FFFFFF"} stroke="#141210" strokeWidth="3" />}
        {finger.pattern === "cat_eye" && accent && <path d="M0 66 L58 26" stroke={accent} strokeWidth="10" />}
        {(finger.kind === "design" || finger.pattern === "art") && finger.pattern !== "french" && finger.pattern !== "ombre" && finger.accentHexes.slice(0, 3).map((hex, i) => (
          <circle key={i} cx={i % 2 ? 36 : 22} cy={46 + i * 14} r="5.5" fill={hex} stroke="#141210" strokeWidth="2" />
        ))}
      </g>
      <path d={NAIL} fill="none" stroke="#141210" strokeWidth="3.5" />
      <path d="M15 34 v16" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}
