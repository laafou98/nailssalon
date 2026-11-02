import { flushSync } from "react-dom";

/** The prototype's screen changes: push forward, pop back, dissolve into Painting and Result, slide up for full-screen sheets. */
export type Transition = "push" | "pop" | "dissolve" | "up";

const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Runs a state change as a screen transition. Browsers without View Transitions (before iOS 18) just change screen. */
export function go(kind: Transition, update: () => void) {
  const scrolled = () => {
    update();
    window.scrollTo(0, 0);
  };
  if (!document.startViewTransition || calm()) return scrolled();
  document.documentElement.dataset.vt = kind;
  const t = document.startViewTransition(() => flushSync(scrolled));
  // A skipped transition (hidden tab, a newer one starting) rejects `ready`; the screen still changes.
  t.ready.catch(() => {});
  t.finished.finally(() => {
    delete document.documentElement.dataset.vt;
  });
}
