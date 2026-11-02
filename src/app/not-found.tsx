import Link from "next/link";

export default function NotFound() {
  return (
    <main className="n-scr">
      <div className="n-fail">
        <div className="n-alert-art white">
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG illustration */}
          <img src="/v2/oops.svg" alt="The polish bottle mascot tipped over" />
        </div>
        <h1 className="n-d n-alert-title">Nothing painted here.</h1>
        <p className="n-body">This link doesn&apos;t lead to a recipe. It may have been mistyped.</p>
      </div>
      <div className="n-cta">
        <Link href="/" className="n-btn n-btn-k">Try your own design</Link>
      </div>
    </main>
  );
}
