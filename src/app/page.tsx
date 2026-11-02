import type { Viewport } from "next";
import Link from "next/link";
import Icon from "@/components/ui/Icon";

export const viewport: Viewport = { themeColor: "#FF4512" };

export default function Home() {
  return (
    <main className="n-scr n-welcome">
      <div className="n-brand">
        <div className="n-d n-logo">
          NAILS
          <br />
          SALON!
        </div>
        <span className="n-eye n-tag">Try before you paint</span>
      </div>
      <h1 className="n-d">
        Wear it
        <br />
        before you
        <br />
        <em>book it.</em>
      </h1>
      <p className="n-lede">Snap your hand, pick any nail photo, see it painted on you. Then send the recipe to your salon.</p>
      <div className="n-stage">
        <div className="n-giant n-d" aria-hidden>
          NAILS
          <br />
          SALON
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG illustration */}
        <img className="n-mascot" src="/v2/mascot.svg" alt="Polish bottle mascot in sunglasses waving its brush" />
      </div>
      <div className="n-cta">
        <Link href="/hand" className="n-btn n-btn-w">
          <Icon name="camera-fill" size={20} />
          Start with my hand
        </Link>
      </div>
    </main>
  );
}
