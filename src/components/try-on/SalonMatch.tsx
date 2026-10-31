"use client";

import { useEffect, useState } from "react";
import type { ColourMatch, FingerMatch, Quote } from "@/lib/shade/match";
import { FINGERS, type DesignSpecInput, type Finger } from "@/lib/spec/types";

/**
 * The salon's real polishes for each finger of the rendered look, and what it costs.
 * Fetched once per mount: give it a key that changes with the spec.
 */

type Reply = {
  salon: { name: string; city: string | null; currency: string };
  matches: Record<Finger, FingerMatch> | null;
  quote: Quote;
};
type State = { status: "loading" } | { status: "ready"; data: Reply } | { status: "error"; error: string };

const FINGER_LABEL: Record<Finger, string> = { thumb: "Thumb", index: "Index", middle: "Middle", ring: "Ring", pinky: "Pinky" };

/** Fingers that share the same polish (and no art) collapse into one row. */
function groupFingers(matches: Record<Finger, FingerMatch>) {
  const groups: { fingers: Finger[]; match: FingerMatch }[] = [];
  for (const finger of FINGERS) {
    const m = matches[finger];
    const same = m.accents.length === 0 &&
      groups.find((g) => g.match.accents.length === 0 && g.match.base.polish.id === m.base.polish.id && g.match.base.topCoat === m.base.topCoat);
    if (same) same.fingers.push(finger);
    else groups.push({ fingers: [finger], match: m });
  }
  return groups;
}

const fingerList = (fingers: Finger[]) =>
  fingers.length === 5 ? "All nails" : fingers.map((f) => FINGER_LABEL[f]).join(", ");

export default function SalonMatch({ spec }: { spec: DesignSpecInput }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spec }) })
      .then(async (res) => {
        const json = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
        if (cancelled) return;
        setState(res.ok ? { status: "ready", data: json as Reply } : { status: "error", error: json.error ?? "Quote failed" });
      })
      .catch((e: unknown) => !cancelled && setState({ status: "error", error: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [spec]);

  if (state.status === "loading") return <p className="text-sm text-zinc-500">Finding the salon&apos;s polishes…</p>;
  if (state.status === "error") return <p className="text-sm text-red-600">Couldn&apos;t match the salon&apos;s polishes: {state.error}</p>;

  const { salon, matches, quote } = state.data;
  const money = (n: number) => `${n.toLocaleString("fr-MA")} ${salon.currency}`;

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
            <span>{money(l.amount)}</span>
          </div>
        ))}
        <div className="flex justify-between font-medium">
          <span>Total · about {quote.minutes} min</span>
          <span>{money(quote.total)}</span>
        </div>
      </div>
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
          {m.topCoat && <span className="text-zinc-500"> + matte top coat</span>}
        </p>
        <p className="text-xs text-zinc-500">
          ΔE {m.deltaE.toFixed(1)}, {m.label}
          {m.alternates.length > 0 && ` · or ${m.alternates.map((a) => a.polish.name).join(", ")}`}
        </p>
      </div>
    </div>
  );
}
