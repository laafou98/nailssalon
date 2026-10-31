"use client";

import { useEffect, useState } from "react";
import { fingerList, groupFingers, money } from "@/lib/recipe/format";
import type { ColourMatch, FingerMatch, Quote } from "@/lib/shade/match";
import type { DesignSpecInput, Finger } from "@/lib/spec/types";

/**
 * The salon's real polishes for each finger of the rendered look, what it costs, and the
 * recipe card to send on WhatsApp. Fetched once per mount: give it a key that changes with the render.
 */

type Reply = {
  salon: { name: string; city: string | null; currency: string };
  matches: Record<Finger, FingerMatch> | null;
  quote: Quote;
};
type State = { status: "loading" } | { status: "ready"; data: Reply } | { status: "error"; error: string };
type Share = { status: "loading" } | { status: "ready"; url: string; whatsapp: string } | { status: "error"; error: string };

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
  if (!res.ok) throw new Error(json.error ?? "Request failed");
  return json as T;
}

export default function SalonMatch({ spec, renderId }: { spec: DesignSpecInput; renderId?: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [share, setShare] = useState<Share>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    post<Reply>("/api/quote", { spec })
      .then((data) => !cancelled && setState({ status: "ready", data }))
      .catch((e: unknown) => !cancelled && setState({ status: "error", error: e instanceof Error ? e.message : String(e) }));
    // The recipe is made up front so "Send on WhatsApp" can be a plain link: iOS blocks
    // opening apps from a tap that first waits on the network.
    if (renderId) {
      post<{ url: string; whatsapp: string }>("/api/recipes", { renderId })
        .then((r) => !cancelled && setShare({ status: "ready", ...r }))
        .catch((e: unknown) => !cancelled && setShare({ status: "error", error: e instanceof Error ? e.message : String(e) }));
    }
    return () => {
      cancelled = true;
    };
  }, [spec, renderId]);

  if (state.status === "loading") return <p className="text-sm text-zinc-500">Finding the salon&apos;s polishes…</p>;
  if (state.status === "error") return <p className="text-sm text-red-600">Couldn&apos;t match the salon&apos;s polishes: {state.error}</p>;

  const { salon, matches, quote } = state.data;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-zinc-300 p-4 dark:border-zinc-700">
      <div>
        <p className="text-sm font-medium">At {salon.name}{salon.city ? `, ${salon.city}` : ""}</p>
        <p className="text-xs text-zinc-500">The closest polishes in stock, measured by colour difference (ΔE 2000).</p>
      </div>

      {matches && (
        <ul className="flex flex-col gap-2">
          {groupFingers(matches).map(({ fingers, match }) => (
            <li key={fingers.join()} className="flex flex-col gap-1">
              <p className="text-xs text-zinc-500">{fingerList(fingers)}</p>
              <MatchRow m={match.base} />
              {match.accents.map((a, i) => (
                <MatchRow key={i} m={a} accent />
              ))}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
        {quote.lines.map((l) => (
          <div key={l.label} className="flex justify-between">
            <span>{l.label}</span>
            <span>{money(l.amount, salon.currency)}</span>
          </div>
        ))}
        <div className="flex justify-between font-medium">
          <span>Total · about {quote.minutes} min</span>
          <span>{money(quote.total, salon.currency)}</span>
        </div>
      </div>

      {renderId && (
        <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          {share.status === "ready" ? (
            <>
              <a
                href={share.whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-[#25D366] px-5 py-3 text-center text-sm font-medium text-black"
              >
                Send the recipe on WhatsApp
              </a>
              <a href={share.url} target="_blank" rel="noopener noreferrer" className="self-center text-xs underline">
                Open the recipe card
              </a>
            </>
          ) : share.status === "loading" ? (
            <p className="text-center text-xs text-zinc-500">Preparing the recipe card…</p>
          ) : (
            <p className="text-sm text-red-600">Couldn&apos;t make the recipe card: {share.error}</p>
          )}
        </div>
      )}
    </section>
  );
}

function MatchRow({ m, accent = false }: { m: ColourMatch; accent?: boolean }) {
  return (
    <div className={`flex items-center gap-3 ${accent ? "pl-4" : ""}`}>
      <span className="flex shrink-0">
        <span className="h-7 w-7 rounded-l-full border border-black/10" style={{ backgroundColor: m.hex }} title={`Design ${m.hex}`} />
        <span className="h-7 w-7 rounded-r-full border border-black/10" style={{ backgroundColor: m.polish.hex }} title={`${m.polish.name} ${m.polish.hex}`} />
      </span>
      <div className="min-w-0 text-sm">
        <p className="truncate">
          {accent && <span className="text-zinc-500">Art: </span>}
          {m.polish.brand} {m.polish.name}
          {m.topCoat && <span className="text-zinc-500"> + {m.topCoat}</span>}
        </p>
        <p className="text-xs text-zinc-500">
          ΔE {m.deltaE.toFixed(1)}, {m.label}
          {m.alternates.length > 0 && ` · or ${m.alternates.map((a) => a.polish.name).join(", ")}`}
        </p>
      </div>
    </div>
  );
}
