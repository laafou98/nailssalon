import Icon from "@/components/ui/Icon";

/** Where a render really is. The API gives no percentage, so the bar follows these stages instead of a made-up number. */
export type PaintStage = 1 | 2 | 3;

const STEPS = ["Reading your hand", "Painting 5 nails", "Matching your salon's polishes"];
/** Stage 2 fills slowly over the usual render time; it never reaches the end on its own. */
const WIDTH: Record<PaintStage, string> = { 1: "20%", 2: "84%", 3: "100%" };

export default function Painting({ stage }: { stage: PaintStage }) {
  return (
    <div className="n-scr n-scr-dark n-paint">
      <div className="n-nav" style={{ padding: "6px 20px 0 24px", height: 46 }}>
        <div className="n-prog" aria-hidden>
          <i className="done" style={{ background: "var(--r)" }} />
          <i className="done" style={{ background: "var(--r)" }} />
          <i className="now" style={{ background: "var(--k2)", "--w": "30%" } as React.CSSProperties} />
        </div>
        <span className="n-eye" style={{ color: "var(--mute-dark)" }}>3/3</span>
      </div>
      <div className="n-paint-giant n-d" aria-hidden>
        PAINT
        <br />
        ING
      </div>
      <svg className="n-paint-art" viewBox="40 20 360 340" role="img" aria-label="A brush painting a fingernail">
        <defs>
          <clipPath id="n-nail-clip">
            <path d="M150 120 Q150 70 200 70 Q250 70 250 120 V210 Q200 226 150 210Z" />
          </clipPath>
        </defs>
        <path d="M118 440 V150 Q118 40 200 40 Q282 40 282 150 V440" fill="#141210" transform="translate(9 9)" />
        <path d="M118 440 V150 Q118 40 200 40 Q282 40 282 150 V440" fill="#fff" stroke="#141210" strokeWidth="7" />
        <path d="M150 300 q50 18 100 0 M160 330 q40 12 80 0" stroke="#141210" strokeWidth="6" fill="none" strokeLinecap="round" />
        <path d="M150 120 Q150 70 200 70 Q250 70 250 120 V210 Q200 226 150 210Z" fill="#fff" />
        <g clipPath="url(#n-nail-clip)">
          <rect className="n-paint-fill" x="140" y="60" width="120" height="170" fill="#FF4512" />
          <path d="M170 100 v40" stroke="#fff" strokeWidth="9" strokeLinecap="round" />
        </g>
        <path d="M150 120 Q150 70 200 70 Q250 70 250 120 V210 Q200 226 150 210Z" fill="none" stroke="#141210" strokeWidth="7" />
        <g className="n-paint-brush">
          <path d="M262 170 L360 40" stroke="#141210" strokeWidth="30" strokeLinecap="round" />
          <path d="M262 170 L360 40" stroke="#fff" strokeWidth="16" strokeLinecap="round" />
          <path d="M236 206 L256 150 L282 170 Z" fill="#FF4512" stroke="#141210" strokeWidth="6" strokeLinejoin="round" />
        </g>
        <path transform="translate(84 90)" d="M0 -20 Q3 -3 20 0 Q3 3 0 20 Q-3 3 -20 0 Q-3 -3 0 -20Z" fill="#FF4512" />
      </svg>
      <div className="n-paint-wrap">
        <h1 className="n-d">
          Painting your
          <br />
          <em>nails…</em>
        </h1>
        <div className="n-pct">
          <b>Step {stage} of 3</b>
          <span>{stage === 3 ? "ALMOST DONE" : "USUALLY ABOUT 15 S"}</span>
        </div>
        <div className="n-bar" role="progressbar" aria-valuetext={STEPS[stage - 1]}>
          <i className={stage === 2 ? "long" : undefined} style={{ width: WIDTH[stage] }} />
        </div>
        <ul className="n-steps" aria-live="polite">
          {STEPS.map((step, i) => {
            const state = i + 1 < stage ? "ok" : i + 1 === stage ? "now" : "";
            return (
              <li key={step} className={state}>
                <i>{state === "ok" && <Icon name="checkmark-alt" size={12} />}</i>
                {step}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
