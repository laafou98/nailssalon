import type { Metadata } from "next";
import HandFlow from "@/components/try-on/HandFlow";

export const metadata: Metadata = {
  title: "Your hand · NailsSalon",
  description: "Take a photo of your hand. We check it on your device before any try-on is rendered.",
};

export default function HandPage() {
  return (
    <main className="flex flex-1 flex-col">
      <HandFlow />
    </main>
  );
}
