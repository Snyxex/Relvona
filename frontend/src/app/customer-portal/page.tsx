"use client";

import { FormEvent, useEffect, useState } from "react";
import { API_BASE_URL } from "@/lib/api";

type PortalDashboard = {
  customer: { id: string; email: string };
  conversations: Array<{ id: string; state: string; summary?: string | null; updatedAt: string }>;
  tickets: Array<{ id: string; ticketNumber: number; subject: string; status: string; priority: string; updatedAt: string }>;
  memories: Array<{ id: string; type: string; summary: string; status: string }>;
  linkedVisitors: string[];
};

const SESSION_KEY = "supportai_customer_portal_session";

export default function CustomerPortalPage() {
  const [organizationId, setOrganizationId] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dashboard, setDashboard] = useState<PortalDashboard | null>(null);
  const [error, setError] = useState("");

  async function loadDashboard(token: string) {
    const response = await fetch(`${API_BASE_URL}/customer-portal/dashboard`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error("Sitzung ist abgelaufen");
    setDashboard(await response.json());
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setOrganizationId(params.get("organizationId") || "");
    const token = sessionStorage.getItem(SESSION_KEY);
    if (token) loadDashboard(token).catch(() => sessionStorage.removeItem(SESSION_KEY));
  }, []);

  async function requestLink(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError("");
    try {
      await fetch(`${API_BASE_URL}/customer-portal/request-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, email }),
      });
      setSent(true);
    } catch { setError("Der Anmeldelink konnte nicht angefordert werden."); }
    finally { setLoading(false); }
  }

  async function logout() {
    const token = sessionStorage.getItem(SESSION_KEY);
    if (token) await fetch(`${API_BASE_URL}/customer-portal/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
    sessionStorage.removeItem(SESSION_KEY);
    setDashboard(null);
  }

  if (dashboard) {
    return <main className="min-h-screen bg-background p-6 md:p-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div><p className="text-sm text-muted-foreground">Kundenportal</p><h1 className="text-2xl font-semibold">{dashboard.customer.email}</h1></div>
          <button onClick={logout} className="rounded-lg border px-4 py-2 text-sm">Abmelden</button>
        </header>
        <section className="grid gap-4 md:grid-cols-3">
          <Stat title="Unterhaltungen" value={dashboard.conversations.length} />
          <Stat title="Tickets" value={dashboard.tickets.length} />
          <Stat title="Gespeicherte Erinnerungen" value={dashboard.memories.length} />
        </section>
        <section className="rounded-xl border bg-card p-5"><h2 className="mb-4 font-semibold">Support-Verlauf</h2><div className="space-y-3">{dashboard.conversations.length ? dashboard.conversations.map((item) => <div key={item.id} className="rounded-lg border p-4"><div className="flex justify-between gap-3"><span className="font-medium">{item.summary || "Support-Unterhaltung"}</span><span className="text-xs text-muted-foreground">{item.state}</span></div><p className="mt-2 text-xs text-muted-foreground">{new Date(item.updatedAt).toLocaleString("de-DE")}</p></div>) : <p className="text-sm text-muted-foreground">Noch keine Unterhaltungen.</p>}</div></section>
        <section className="rounded-xl border bg-card p-5"><h2 className="mb-4 font-semibold">Tickets</h2><div className="space-y-3">{dashboard.tickets.length ? dashboard.tickets.map((ticket) => <div key={ticket.id} className="rounded-lg border p-4"><div className="flex justify-between gap-3"><span className="font-medium">#{ticket.ticketNumber} {ticket.subject}</span><span className="text-xs text-muted-foreground">{ticket.status}</span></div><p className="mt-2 text-xs text-muted-foreground">Priorität: {ticket.priority}</p></div>) : <p className="text-sm text-muted-foreground">Keine offenen Tickets.</p>}</div></section>
        <section className="rounded-xl border bg-card p-5"><h2 className="mb-2 font-semibold">KI-Memory</h2><p className="mb-4 text-sm text-muted-foreground">Hier erscheinen nur Erinnerungen aus ausdrücklich mit dem Portal verknüpften anonymen Browser-Sitzungen.</p><div className="space-y-2">{dashboard.memories.length ? dashboard.memories.map((memory) => <div key={memory.id} className="rounded-lg border p-3 text-sm"><span className="mr-2 text-xs text-muted-foreground">{memory.type}</span>{memory.summary}</div>) : <p className="text-sm text-muted-foreground">Keine verknüpften Erinnerungen.</p>}</div></section>
      </div>
    </main>;
  }

  return <main className="flex min-h-screen items-center justify-center bg-background p-6"><div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm"><p className="text-sm text-muted-foreground">Customer Support</p><h1 className="mt-1 text-2xl font-semibold">Kundenportal</h1><p className="mt-2 text-sm text-muted-foreground">Melde dich per sicherem E-Mail-Link an. Es ist kein Passwort erforderlich.</p>{sent ? <div className="mt-6 rounded-lg border p-4 text-sm">Falls die Adresse gültig ist, wurde ein Anmeldelink versendet.</div> : <form onSubmit={requestLink} className="mt-6 space-y-4"><label className="block text-sm">Organisation<input className="mt-1 w-full rounded-lg border bg-background px-3 py-2" required value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} placeholder="Organisation-ID" /></label><label className="block text-sm">E-Mail<input className="mt-1 w-full rounded-lg border bg-background px-3 py-2" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@firma.de" /></label>{error && <p className="text-sm text-destructive">{error}</p>}<button disabled={loading} className="w-full rounded-lg bg-foreground px-4 py-2 text-background disabled:opacity-50">{loading ? "Wird gesendet…" : "Anmeldelink senden"}</button></form>}</div></main>;
}

function Stat({ title, value }: { title: string; value: number }) {
  return <div className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">{title}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div>;
}
