"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Trigger = "ticket.created" | "ticket.updated" | "ticket.idle";
type Action = { type: "set_priority"; priority: string } | { type: "assign_agent"; userId: string }
  | { type: "add_tag"; tag: string } | { type: "notify_admins"; message: string };
type Conditions = { priorities?: string[]; statuses?: string[]; tagsAny?: string[]; onlyUnassigned?: boolean; subjectIncludes?: string };
type Rule = { id: string; name: string; description: string | null; enabled: boolean; trigger: Trigger; idleMinutes: number | null; conditions: Conditions; actions: Action[] };
type Run = { id: string; createdAt: string; ruleName: string; ticketId: string; trigger: string; actionsApplied: string[] };
type Member = { userId: string; name: string };
const triggers: { value: Trigger; label: string }[] = [
  { value: "ticket.created", label: "Neues Ticket" },
  { value: "ticket.updated", label: "Ticket geändert" },
  { value: "ticket.idle", label: "Ticket unbearbeitet" },
];
const actionTypes = [
  { value: "set_priority", label: "Priorität ändern" },
  { value: "assign_agent", label: "Mitarbeiter zuweisen" },
  { value: "add_tag", label: "Tag ergänzen" },
  { value: "notify_admins", label: "Admins benachrichtigen" },
] as const;
const empty = (): Omit<Rule, "id"> => ({
  name: "", description: "", enabled: false, trigger: "ticket.created", idleMinutes: null,
  conditions: {}, actions: [{ type: "notify_admins", message: "Ein Ticket benötigt Aufmerksamkeit." }],
});
function newAction(type: Action["type"]): Action {
  if (type === "set_priority") return { type, priority: "high" };
  if (type === "assign_agent") return { type, userId: "" };
  if (type === "add_tag") return { type, tag: "" };
  return { type: "notify_admins", message: "" };
}

export default function SupportAutomationsPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [form, setForm] = useState<Omit<Rule,"id">>(empty());
  const [editing, setEditing] = useState<string | null>(null);
  const [simulateTicketId, setSimulateTicketId] = useState("");
  const [preview, setPreview] = useState<{matched:boolean;dryRun:boolean;note:string}|null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function load() {
    const [rulesResponse, runsResponse, membersResponse] = await Promise.all([
      api.get("/support-automations"), api.get("/support-automations/runs"),
      api.get("/admin/employees"),
    ]);
    setRules(rulesResponse.data); setRuns(runsResponse.data); setMembers(membersResponse.data.members || []);
  }
  useEffect(()=>{void load().catch(()=>setError("Automationsdaten konnten nicht geladen werden."));},[]);
  function edit(rule: Rule) {
    setEditing(rule.id);
    setForm({
      name: rule.name, description: rule.description, enabled: rule.enabled, trigger: rule.trigger,
      idleMinutes: rule.idleMinutes, conditions: rule.conditions, actions: rule.actions,
    });
    setPreview(null); setError(""); setMessage("");
  }
  function reset() {setEditing(null);setForm(empty());setPreview(null);setError("");}
  function condition(patch: Partial<Conditions>) {setForm(f=>({...f,conditions:{...f.conditions,...patch}}));}
  function updateAction(index:number, action:Action) {
    setForm(f=>({...f,actions:f.actions.map((a,i)=>i===index?action:a)}));
  }
  async function save() {
    setBusy(true); setError("");setMessage("");
    try {
      if (editing) await api.put(`/support-automations/${editing}`,form);
      else await api.post("/support-automations",form);
      await load();reset();setMessage("Regel gespeichert.");
    } catch(e:any) {setError(e.response?.data?.error||"Regel konnte nicht gespeichert werden.");}
    finally {setBusy(false);}
  }
  async function remove(id:string) {
    if (!window.confirm("Regel und ihr Ausführungsprotokoll endgültig löschen?")) return;
    setBusy(true);setError("");
    try {await api.delete(`/support-automations/${id}`);await load();if(editing===id)reset();setMessage("Regel gelöscht.");}
    catch(e:any){setError(e.response?.data?.error||"Löschen fehlgeschlagen.");}
    finally{setBusy(false);}
  }
  async function toggle(rule:Rule) {
    setBusy(true);setError("");
    try {
      const {id,...values}=rule;
      await api.put(`/support-automations/${id}`,{...values,enabled:!rule.enabled});
      await load();
    } catch(e:any){setError(e.response?.data?.error||"Status konnte nicht geändert werden.");}
    finally{setBusy(false);}
  }
  async function simulate(){
    setBusy(true);setError("");setPreview(null);
    try {const {data}=await api.post("/support-automations/simulate",{ticketId:simulateTicketId,rule:form});setPreview(data);}
    catch(e:any){setError(e.response?.data?.error||"Simulation fehlgeschlagen.");}
    finally{setBusy(false);}
  }
  return <main className="mx-auto max-w-6xl space-y-7 p-5 text-slate-100">
    <header><h1 className="text-2xl font-semibold">Support-Automationen</h1>
      <p className="mt-2 text-sm text-slate-400">Regeln basierend auf Ticket-Ereignissen und Bedingungen. Neue Regeln sind standardmäßig deaktiviert und können vorab simuliert werden.</p></header>
    {error&&<p role="alert" className="rounded border border-red-700 p-3 text-sm text-red-300">{error}</p>}
    {message&&<p role="status" className="rounded border border-slate-700 p-3 text-sm">{message}</p>}
    <section className="rounded-xl border border-slate-700 p-5"><h2 className="text-lg font-semibold">Bestehende Regeln ({rules.length})</h2>
      <div className="mt-4 space-y-3">
      {rules.map(rule=><div className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-800 p-3" key={rule.id}>
        <div><p className="font-semibold">{rule.name}</p><p className="text-xs text-slate-400">{triggers.find(t=>t.value===rule.trigger)?.label} · {rule.actions.length} Aktion(en) · {rule.enabled?"Aktiv":"Deaktiviert"}</p></div>
        <div className="flex gap-2 text-sm">
          <button disabled={busy} onClick={()=>edit(rule)} className="rounded border border-slate-600 px-3 py-2">Bearbeiten</button>
          <button disabled={busy} onClick={()=>void toggle(rule)} className="rounded border border-slate-600 px-3 py-2">{rule.enabled?"Deaktivieren":"Aktivieren"}</button>
          <button disabled={busy} onClick={()=>void remove(rule.id)} className="rounded border border-red-900 px-3 py-2 text-red-300">Löschen</button>
        </div>
      </div>)}
      {!rules.length&&<p className="text-sm text-slate-400">Noch keine Regeln vorhanden.</p>}
      </div>
    </section>
    <section className="space-y-4 rounded-xl border border-slate-700 p-5">
      <div className="flex justify-between gap-3"><h2 className="text-lg font-semibold">{editing?"Regel bearbeiten":"Neue Regel"}</h2>{editing&&<button onClick={reset} className="text-sm text-slate-300">Neue Regel</button>}</div>
      <label className="block text-sm">Name<input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} maxLength={100} placeholder="Dringende Tickets eskalieren" className="mt-1 block w-full rounded border border-slate-700 bg-slate-900 p-2"/></label>
      <label className="block text-sm">Beschreibung<textarea value={form.description||""} onChange={e=>setForm(f=>({...f,description:e.target.value}))} maxLength={500} rows={2} className="mt-1 block w-full rounded border border-slate-700 bg-slate-900 p-2"/></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Auslöser<select value={form.trigger} onChange={e=>setForm(f=>({...f,trigger:e.target.value as Trigger,idleMinutes:e.target.value==="ticket.idle"?120:null}))} className="mt-1 block w-full rounded bg-slate-900 p-2">
          {triggers.map(t=><option value={t.value} key={t.value}>{t.label}</option>)}
        </select></label>
        {form.trigger==="ticket.idle"&&<label className="text-sm">Unbearbeitet seit (Min.)<input type="number" min={5} max={10080} value={form.idleMinutes??120} onChange={e=>setForm(f=>({...f,idleMinutes:Number(e.target.value)}))} className="mt-1 block w-full rounded bg-slate-900 p-2"/></label>}
      </div>
      <h3 className="font-semibold">Bedingungen (UND-Verknüpfung)</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Priorität<select value={form.conditions.priorities?.[0]||""} onChange={e=>condition({priorities:e.target.value?[e.target.value]:undefined})} className="mt-1 block w-full rounded bg-slate-900 p-2">
          <option value="">Alle Prioritäten</option>{["low","normal","high","urgent"].map(v=><option value={v} key={v}>{v}</option>)}
        </select></label>
        <label className="text-sm">Status<select value={form.conditions.statuses?.[0]||""} onChange={e=>condition({statuses:e.target.value?[e.target.value]:undefined})} className="mt-1 block w-full rounded bg-slate-900 p-2">
          <option value="">Alle Status</option>{["open","pending","in_progress","resolved","closed"].map(v=><option value={v} key={v}>{v}</option>)}
        </select></label>
        <label className="text-sm">Ticket-Betreff enthält<input value={form.conditions.subjectIncludes||""} maxLength={120} onChange={e=>condition({subjectIncludes:e.target.value||undefined})} className="mt-1 block w-full rounded bg-slate-900 p-2"/></label>
        <label className="text-sm">Tags (mindestens einer, Komma getrennt)<input value={form.conditions.tagsAny?.join(", ")||""} onChange={e=>condition({tagsAny:e.target.value?e.target.value.split(",").map(s=>s.trim()).filter(Boolean):undefined})} className="mt-1 block w-full rounded bg-slate-900 p-2"/></label>
      </div>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.conditions.onlyUnassigned||false} onChange={e=>condition({onlyUnassigned:e.target.checked})}/>Nur unzugewiesene Tickets</label>
      <h3 className="font-semibold">Aktionen (max. 5 unterschiedliche)</h3>
      <div className="space-y-3">{form.actions.map((action,index)=><div key={index} className="flex flex-wrap items-center gap-3 rounded border border-slate-700 p-3">
        <select aria-label="Aktionstyp" value={action.type} onChange={e=>updateAction(index,newAction(e.target.value as Action["type"]))} className="rounded bg-slate-900 p-2 text-sm">
          {actionTypes.map(a=><option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
        {action.type==="set_priority"&&<select aria-label="Zielpriorität" value={action.priority} onChange={e=>updateAction(index,{...action,priority:e.target.value})} className="rounded bg-slate-900 p-2 text-sm">
          {["low","normal","high","urgent"].map(p=><option key={p} value={p}>{p}</option>)}
        </select>}
        {action.type==="assign_agent"&&<select aria-label="Mitarbeiter" value={action.userId} onChange={e=>updateAction(index,{...action,userId:e.target.value})} className="rounded bg-slate-900 p-2 text-sm">
          <option value="">Mitarbeiter auswählen</option>{members.map(m=><option key={m.userId} value={m.userId}>{m.name}</option>)}
        </select>}
        {action.type==="add_tag"&&<input aria-label="Neuer Tag" value={action.tag} maxLength={64} onChange={e=>updateAction(index,{...action,tag:e.target.value})} placeholder="Tag" className="min-w-40 flex-1 rounded bg-slate-900 p-2 text-sm"/>}
        {action.type==="notify_admins"&&<input aria-label="Nachricht" value={action.message} maxLength={300} onChange={e=>updateAction(index,{...action,message:e.target.value})} placeholder="Benachrichtigungstext" className="min-w-40 flex-1 rounded bg-slate-900 p-2 text-sm"/>}
        <button disabled={form.actions.length<=1} onClick={()=>setForm(f=>({...f,actions:f.actions.filter((_,i)=>i!==index)}))} className="text-sm text-red-300">Entfernen</button>
      </div>)}</div>
      <button disabled={form.actions.length>=5} onClick={()=>setForm(f=>({...f,actions:[...f.actions,newAction("add_tag")]}))} className="rounded border border-slate-600 px-3 py-2 text-sm">Aktion hinzufügen</button>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={e=>setForm(f=>({...f,enabled:e.target.checked}))}/>Regel aktivieren</label>
      <div className="flex flex-wrap gap-3"><button disabled={busy||!form.name.trim()} onClick={()=>void save()} className="rounded bg-blue-600 px-4 py-2 text-sm disabled:opacity-50">{editing?"Änderungen speichern":"Regel erstellen"}</button>
      <label className="text-sm">Simulation für Ticket-ID<input value={simulateTicketId} onChange={e=>setSimulateTicketId(e.target.value)} placeholder="UUID des Tickets" className="ml-2 rounded bg-slate-900 p-2"/></label>
      <button disabled={busy||!simulateTicketId.trim()} onClick={()=>void simulate()} className="rounded border border-slate-600 px-4 py-2 text-sm">Ohne Ausführung testen</button></div>
      {preview&&<p className="rounded border border-slate-700 p-3 text-sm">{preview.matched?"Bedingungen erfüllt":"Bedingungen nicht erfüllt"} · {preview.note}</p>}
    </section>
    <section className="rounded-xl border border-slate-700 p-5"><h2 className="text-lg font-semibold">Ausführungsprotokoll</h2>
      <div className="mt-3 space-y-2">{runs.map(run=><div key={run.id} className="rounded border border-slate-800 p-3 text-xs text-slate-300">
        <span className="font-semibold">{run.ruleName}</span> · {new Date(run.createdAt).toLocaleString("de-DE")} · {run.trigger}
        <p className="mt-1">Ticket: {run.ticketId} · Aktionen: {run.actionsApplied.join(", ")||"Keine Änderung erforderlich"}</p>
      </div>)}{!runs.length&&<p className="text-sm text-slate-400">Noch keine Regelausführungen.</p>}</div>
    </section>
  </main>;
}
