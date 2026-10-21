import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center font-sans">
      <h1 className="text-4xl font-semibold tracking-tight">NailsSalon</h1>
      <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">
        Inspiration photo → exact, editable spec → on your own hand → matched to your salon&apos;s
        real polishes.
      </p>
      <Link
        href="/hand"
        className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900"
      >
        Start with your hand
      </Link>
      <p className="text-sm text-zinc-500">Under construction for the YouCam API Hackathon.</p>
    </main>
  );
}
