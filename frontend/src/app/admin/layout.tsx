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
 if (error) return <main className="min-h-screen bg-slate-950 p-4 text-white sm:p-10"><h1 className="text-xl font-bold">Plattformverwaltung</h1><p role="alert" className="my-6 break-words">{error}</p><Link href="/" className="text-blue-300">Zum Mitarbeiter-Dashboard</Link></main>;
 if (!ready) return <p role="status" className="p-4 sm:p-10">Berechtigung wird geprüft ...</p>;
 return <><header className="flex flex-col gap-3 border-b border-slate-700 bg-slate-950 px-4 py-4 text-white sm:px-6 lg:flex-row lg:items-center lg:gap-5"><Link href="/admin" className="font-bold">SupportAI · Plattformverwaltung</Link><label className="flex min-w-0 flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3"><span>Organisation</span><select className="min-w-0 max-w-full rounded border border-slate-600 bg-slate-900 p-2" value={selected} onChange={e => { localStorage.setItem("active_org_id", e.target.value); setSelected(e.target.value); }}>{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label><nav className="flex flex-wrap gap-3 text-sm lg:ml-auto"><Link href="/admin/actions" className="text-blue-300">AI Actions</Link><Link href="/admin/scheduling" className="text-blue-300">Scheduling</Link><Link href="/" className="text-blue-300">Mitarbeiter-Dashboard</Link></nav></header>{selected ? <div key={selected} className="min-w-0">{children}</div> : <p className="p-4 sm:p-10">Noch keine Organisation vorhanden. Erstellen Sie zunächst eine Organisation über die Registrierung.</p>}</>;
}
