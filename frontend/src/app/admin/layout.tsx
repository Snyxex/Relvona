"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
type Organization = { id: string; name: string };
export default function AdminLayout({ children }: { children: ReactNode }) {
 const [organizations, setOrganizations] = useState<Organization[]>([]);
 const [selected, setSelected] = useState("");
 const [error, setError] = useState("");
 const [ready, setReady] = useState(false);
 useEffect(() => { let active = true;
 api.get("/admin/organizations").then(({data}) => {
 if (!active) return;
 setOrganizations(data);
 const id = data.find((org: Organization) => org.id === localStorage.getItem("active_org_id"))?.id || data[0]?.id || "";
 if (id) localStorage.setItem("active_org_id", id);
 setSelected(id); setReady(true);
 }).catch(e => { if (active) setError(e.response?.data?.error || "Verwaltung konnte nicht geladen werden."); });
 return () => { active = false; };
 }, []);
 if (error) return <main className="min-h-screen bg-slate-950 p-10 text-white"><h1>Plattformverwaltung</h1><p role="alert" className="my-6">{error}</p><Link href="/">Zum Mitarbeiter-Dashboard</Link></main>;
 if (!ready) return <p role="status" className="p-10">Berechtigung wird geprüft ...</p>;
 return <><header className="flex flex-wrap items-center gap-5 border-b border-slate-700 bg-slate-950 px-6 py-4 text-white"><Link href="/admin" className="font-bold">SupportAI · Plattformverwaltung</Link><label className="flex items-center gap-3 text-sm">Organisation<select className="rounded border border-slate-600 bg-slate-900 p-2" value={selected} onChange={e => { localStorage.setItem("active_org_id", e.target.value); setSelected(e.target.value); }}>{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label><Link href="/" className="ml-auto text-sm text-blue-300">Mitarbeiter-Dashboard</Link></header>{selected ? <div key={selected}>{children}</div> : <p className="p-10">Noch keine Organisation vorhanden. Erstellen Sie zunächst eine Organisation über die Registrierung.</p>}</>;
}
