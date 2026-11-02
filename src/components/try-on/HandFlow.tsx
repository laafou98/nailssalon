"use client";

import { useState } from "react";
import HandGate from "@/components/hand-gate/HandGate";
import type { GatedPhoto } from "@/lib/hand-gate/browser";
import { go } from "@/lib/transition";
import TryOn from "./TryOn";

/** Photo first (checked on the device), then try-on with that photo. Both stay mounted so Back keeps their state. */
export default function HandFlow() {
  const [photo, setPhoto] = useState<GatedPhoto | null>(null);
  const [designing, setDesigning] = useState(false);
  /** Bumped to start over with a fresh camera. */
  const [attempt, setAttempt] = useState(0);

  const retake = () =>
    go("pop", () => {
      setPhoto(null);
      setDesigning(false);
      setAttempt((a) => a + 1);
    });

  return (
    <>
      <div hidden={designing}>
        <HandGate
          key={attempt}
          onAccept={(p) =>
            go("push", () => {
              setPhoto(p);
              setDesigning(true);
            })
          }
        />
      </div>
      {photo && (
        <div hidden={!designing}>
          <TryOn key={photo.url} photo={photo} onBack={() => go("pop", () => setDesigning(false))} onRetake={retake} />
        </div>
      )}
    </>
  );
}
