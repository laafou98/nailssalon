import Icon, { type IconName } from "./Icon";

/** Top bar: back button, the three steps, and the step count (or a trailing action). */
export default function StepNav({
  onBack,
  step,
  fill = 40,
  icon = "chevron-left",
  label = "Back",
  trailing,
}: {
  onBack?: () => void;
  step: 1 | 2 | 3;
  /** How far through the current step, in percent. */
  fill?: number;
  icon?: IconName;
  label?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="n-nav">
      {onBack && (
        <button className="n-ib" onClick={onBack} aria-label={label}>
          <Icon name={icon} />
        </button>
      )}
      <div className="n-prog" aria-hidden>
        {[1, 2, 3].map((s) => (
          <i key={s} className={s < step ? "done" : s === step ? (fill >= 100 ? "done" : "now") : ""} style={s === step ? ({ "--w": `${fill}%` } as React.CSSProperties) : undefined} />
        ))}
      </div>
      {trailing ?? <span className="n-eye n-prog-count">{step}/3</span>}
    </div>
  );
}
