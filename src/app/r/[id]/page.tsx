import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { FINISH_LABEL, fingerList, groupFingers, money, serviceLabel } from "@/lib/recipe/format";
import { loadRecipe as load } from "@/lib/recipe/service";
import type { ColourMatch } from "@/lib/shade/match";
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
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10 font-sans">
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading the recipe…</p>}>
        {params.then(({ id }) => <Recipe id={id} />)}
      </Suspense>
    </main>
  );
}

async function Recipe({ id }: { id: string }) {
  const recipe = await loadRecipe(id);
  if (!recipe) notFound();
  const { salon, spec, matches, quote } = recipe;
  const image = await signedUrl(recipe.imagePath);

  return (
    <div className="flex w-full max-w-xl flex-col gap-5">
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wide text-zinc-500">Nail recipe</p>
        <h1 className="text-3xl font-semibold tracking-tight">{serviceLabel(spec)}</h1>
        <p className="text-sm text-zinc-500">
          For {salon.name}{salon.city ? `, ${salon.city}` : ""} · {new Date(recipe.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
        </p>
      </header>

      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
      <img src={image} alt="The design on the client's hand" className="w-full rounded-2xl" />
      {recipe.engine === "nail_transfer" && (
        <p className="text-xs text-zinc-500">Approximate preview: copied from the inspiration photo as a whole, so check which finger carries which design.</p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Polishes</h2>
        <ul className="flex flex-col gap-3">
          {groupFingers(matches).map(({ fingers, match }) => {
            const f = spec.fingers[fingers[0]];
            const pattern = f.kind === "design" ? (f.pattern === "solid" ? "nail art" : f.pattern.replace("_", " ")) : f.pattern === "solid" ? null : f.pattern.replace("_", " ");
            return (
              <li key={fingers.join()} className="flex flex-col gap-1.5 rounded-xl border border-zinc-300 p-3 dark:border-zinc-700">
                <p className="text-xs text-zinc-500">
                  {fingerList(fingers)} · {FINISH_LABEL[f.texture]}{pattern ? ` · ${pattern}` : ""}
                </p>
                <PolishRow m={match.base} />
                {match.accents.map((a, i) => (
                  <PolishRow key={i} m={a} label="Art" />
                ))}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-1 text-sm">
        <h2 className="mb-1 text-sm font-medium">Estimate</h2>
        {quote.lines.map((l) => (
          <div key={l.label} className="flex justify-between">
            <span>{l.label}</span>
            <span>{money(l.amount, salon.currency)}</span>
          </div>
        ))}
        <div className="mt-1 flex justify-between border-t border-zinc-200 pt-2 font-medium dark:border-zinc-800">
          <span>Total · about {quote.minutes} min</span>
          <span>{money(quote.total, salon.currency)}</span>
        </div>
        <p className="mt-1 text-xs text-zinc-500">An estimate from the salon&apos;s price list; the technician confirms it at the appointment.</p>
      </section>

      <Link href="/hand" className="self-center rounded-full border border-zinc-300 px-5 py-2.5 text-sm dark:border-zinc-700">
        Try a design on your own hand
      </Link>
    </div>
  );
}

function PolishRow({ m, label }: { m: ColourMatch; label?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-8 w-8 shrink-0 rounded-full border border-black/10" style={{ backgroundColor: m.polish.hex }} />
      <div className="min-w-0 text-sm">
        <p>
          {label && <span className="text-zinc-500">{label}: </span>}
          {m.polish.brand} {m.polish.name}
          {m.topCoat && <span className="text-zinc-500"> + {m.topCoat}</span>}
        </p>
        <p className="text-xs text-zinc-500">
          {m.polish.hex} · ΔE {m.deltaE.toFixed(1)} from the design, {m.label}
        </p>
      </div>
    </div>
  );
}
