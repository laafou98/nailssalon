"use client";

import { useEffect } from "react";

/** iOS Safari only applies :active (the press-scale) when the page has a touch listener. */
export default function TouchActive() {
  useEffect(() => {
    const noop = () => {};
    document.addEventListener("touchstart", noop, { passive: true });
    return () => document.removeEventListener("touchstart", noop);
  }, []);
  return null;
}
