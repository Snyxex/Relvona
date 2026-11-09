export default function Loading() {
  return (
    <main role="status" aria-busy="true">
      <div className="mx-auto max-w-6xl space-y-5">
        <span className="sr-only">Einstellungen werden geladen …</span>
        <div className="h-8 w-56 max-w-full animate-pulse rounded bg-slate-200" />
        <div className="h-80 animate-pulse rounded-xl bg-slate-200" />
      </div>
    </main>
  );
}
