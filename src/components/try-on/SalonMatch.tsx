"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";
import { FINISH_LABEL, durationLabel, groupFingers } from "@/lib/recipe/format";
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
export type Share = { status: "loading" } | { status: "ready"; url: string; whatsapp: string } | { status: "error"; error: string };

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
  if (!res.ok) throw new Error(json.error ?? "Request failed");
  return json as T;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function SalonMatch({
  spec,
  renderId,
  onSettled,
  onShare,
  onChangeDesign,
}: {
  spec: DesignSpecInput;
  renderId?: string;
  /** The quote came back, or failed: nothing left to wait for. */
  onSettled: () => void;
  onShare: (share: Share) => void;
  onChangeDesign: () => void;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [share, setShare] = useState<Share>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    post<Reply>("/api/quote", { spec })
      .then((data) => !cancelled && setState({ status: "ready", data }))
      .catch((e: unknown) => !cancelled && setState({ status: "error", error: e instanceof Error ? e.message : String(e) }))
      .finally(() => !cancelled && onSettled());
    // The recipe is made up front so "Send on WhatsApp" can be a plain link: iOS blocks
    // opening apps from a tap that first waits on the network.
    if (renderId) {
      const shared = (s: Share) => {
        if (cancelled) return;
        setShare(s);
        onShare(s);
      };
      post<{ url: string; whatsapp: string }>("/api/recipes", { renderId })
        .then((r) => shared({ status: "ready", ...r }))
        .catch((e: unknown) => shared({ status: "error", error: e instanceof Error ? e.message : String(e) }));
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per render; the callbacks only report back
  }, [spec, renderId]);

  const change = (
    <button className="n-btn n-btn-soft" onClick={onChangeDesign}>
      Change the design
    </button>
  );

  if (state.status === "loading") return <p className="n-note">Finding the salon&apos;s polishes…</p>;
  if (state.status === "error") {
    return (
      <>
        <p className="n-note n-note-err">Couldn&apos;t match the salon&apos;s polishes: {state.error}</p>
        <div className="n-stack-btns" style={{ marginBottom: 24 }}>{change}</div>
      </>
    );
  }

  const { salon, matches, quote } = state.data;

  return (
    <>
      <section className="n-sec">
        <h2 className="n-d">From your salon&apos;s shelf</h2>
        <p className="n-sub">
          The closest polish {salon.name}{salon.city ? `, ${salon.city},` : ""} stocks for every nail, measured by colour difference (ΔE 2000).
        </p>
        {matches && (
          <ul className="n-pol">
            {groupFingers(matches).flatMap(({ fingers, match }) => [
              <MatchRow key={fingers.join()} m={match.base} fingers={fingers} />,
              ...match.accents.map((a, i) => <MatchRow key={`${fingers.join()}-${i}`} m={a} fingers={fingers} accent />),
            ])}
          </ul>
        )}
      </section>

      <section className="n-est">
        <p className="n-eye">Estimate</p>
        <div className="n-price">
          <b className="n-d">{quote.total.toLocaleString("fr-MA")}</b>
          <span>{salon.currency} · about {durationLabel(quote.minutes)}</span>
        </div>
        <div className="n-lines">
          {quote.lines.map((l) => (
            <div key={l.label}>
              <span>{l.label}</span>
              <span>{l.amount.toLocaleString("fr-MA")}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="n-stack-btns">
        {share.status === "ready" && (
          <a className="n-btn n-btn-soft" href={share.url} target="_blank" rel="noopener noreferrer">
            Open the recipe card
            <Icon name="chevron-right" size={14} />
          </a>
        )}
        {change}
      </div>

      {renderId && (
        <div className="n-cta">
          {share.status === "ready" ? (
            <a className="n-btn n-btn-wa" href={share.whatsapp} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo */}
              <img src="/v2/whatsapp.svg" alt="" />
              Send to my salon
            </a>
          ) : share.status === "loading" ? (
            <button className="n-btn n-btn-wa" disabled>Preparing the recipe card…</button>
          ) : (
            <p className="n-note n-note-err" style={{ margin: 0 }}>Couldn&apos;t make the recipe card: {share.error}</p>
          )}
        </div>
      )}
    </>
  );
}

function MatchRow({ m, fingers, accent = false }: { m: ColourMatch; fingers: Finger[]; accent?: boolean }) {
  return (
    <li className="n-pr">
      <span className="n-pr-bottle">
        <svg viewBox="0 0 34 42" aria-hidden>
          <rect x="11" y="1.5" width="12" height="13" rx="3" fill="#141210" />
          <rect x="3" y="13" width="28" height="27" rx="8" fill={m.polish.hex} stroke="#141210" strokeWidth="2.5" />
        </svg>
        <u style={{ backgroundColor: m.hex }} title={`Design ${m.hex}`} />
      </span>
      <div className="n-pr-text">
        <b>{m.polish.name}</b>
        <small>
          {accent && "Art · "}
          {m.polish.brand} · {capitalise(FINISH_LABEL[m.polish.finish])}
          {m.topCoat && ` + ${m.topCoat}`}
        </small>
        <small>
          ΔE {m.deltaE.toFixed(1)}, {m.label}
          {m.alternates.length > 0 && ` · or ${m.alternates.map((a) => a.polish.name).join(", ")}`}
        </small>
      </div>
      <span className="n-fg" aria-label={fingers.join(", ")}>
        {fingers.length === 5 ? <span>ALL</span> : fingers.map((f) => <span key={f}>{f[0].toUpperCase()}</span>)}
      </span>
    </li>
  );
}
