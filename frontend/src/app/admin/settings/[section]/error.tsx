"use client";
export default function SettingsError({ retry }: { error: Error; retry: () => void }) {
  return <main className="grid min-h-screen place-items-center p-8"><div className="text-center"><p className="text-lg font-semibold">Einstellungen konnten nicht geladen werden.</p><button type="button" className="mt-4 rounded bg-slate-900 px-4 py-2 text-white" onClick={retry}>Erneut versuchen</button></div></main>;
}
