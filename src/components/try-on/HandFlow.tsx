"use client";

import { useState } from "react";
import HandGate from "@/components/hand-gate/HandGate";
import type { GatedPhoto } from "@/lib/hand-gate/browser";
import TryOn from "./TryOn";

/** Photo first (checked on the device), then try-on with that photo. */
export default function HandFlow() {
  const [photo, setPhoto] = useState<GatedPhoto | null>(null);

  if (!photo) return <HandGate onAccept={setPhoto} />;
  return (
    <div className="flex w-full max-w-xl flex-col items-center gap-3">
      <TryOn photo={photo} />
      <button onClick={() => setPhoto(null)} className="text-sm text-zinc-500 underline">
        Retake hand photo
      </button>
    </div>
  );
}
