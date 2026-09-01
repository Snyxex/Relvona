"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return <main className="grid min-h-screen place-items-center p-8"><div className="text-center"><p className="text-lg font-semibold">Einstellungen konnten nicht geladen werden.</p><button className="mt-4 rounded bg-slate-900 px-4 py-2 text-white" onClick={reset}>Erneut versuchen</button></div></main>;
}
