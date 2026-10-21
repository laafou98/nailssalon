import type { Metadata } from "next";
import HandFlow from "@/components/try-on/HandFlow";

export const metadata: Metadata = {
  title: "Your hand · NailsSalon",
  description: "Take a photo of your hand. We check it on your device before any try-on is rendered.",
};

export default function HandPage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-6 px-4 py-10 font-sans">
      <h1 className="text-3xl font-semibold tracking-tight">Your hand</h1>
      <HandFlow />
    </main>
  );
}
