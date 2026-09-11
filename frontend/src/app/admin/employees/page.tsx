"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Save, Trash2, UserRound } from "lucide-react";
import { api } from "@/lib/api";

type Member = { userId: string; role: string; name: string; email: string };
type Employee = {
  id?: string; userId?: string | null; displayName: string; email?: string | null; phone?: string | null;
  department?: string | null; jobTitle?: string | null; skills: string[]; notes?: string | null;
  aiVisible: boolean; exposeEmailToCustomer: boolean; exposePhoneToCustomer: boolean;
  allowDirectHandoff: boolean; enabled: boolean;
};

const emptyEmployee = (): Employee => ({
  userId: null, displayName: "", email: "", phone: "", department: "", jobTitle: "", skills: [], notes: "",
  aiVisible: true, exposeEmailToCustomer: false, exposePhoneToCustomer: false, allowDirectHandoff: false, enabled: true,
});

const inputClass = "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-blue-500";

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<Employee>(emptyEmployee());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/employees");
      setEmployees(data.employees || []);
      setMembers(data.members || []);
      if (!selectedId && data.employees?.[0]) {
        setSelectedId(data.employees[0].id);
        setForm(data.employees[0]);
      }
    } catch (e: any) { setError(e.response?.data?.error || "Mitarbeiter konnten nicht geladen werden."); }
  }, [selectedId]);

  useEffect(() => { void load(); }, [load]);

  const select = (employee: Employee) => { setSelectedId(employee.id || null); setForm({ ...employee }); setError(""); setNotice(""); };
  const createNew = () => { setSelectedId("new"); setForm(emptyEmployee()); setError(""); setNotice(""); };
  const change = (key: keyof Employee, value: any) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true); setError(""); setNotice("");
    try {
      const payload = { ...form, skills: form.skills.filter(Boolean) };
      const { data } = selectedId === "new"
        ? await api.post("/admin/employees", payload)
        : await api.put(`/admin/employees/${selectedId}`, payload);
      setSelectedId(data.id); setForm(data); setNotice("Mitarbeiter gespeichert.");
      const refreshed = await api.get("/admin/employees"); setEmployees(refreshed.data.employees || []); setMembers(refreshed.data.members || []);
    } catch (e: any) { setError(e.response?.data?.error || "Speichern fehlgeschlagen."); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!form.id) return;
    try {
      await api.delete(`/admin/employees/${form.id}`);
      setSelectedId(null); setForm(emptyEmployee()); setNotice("Mitarbeiter gelöscht."); await load();
    } catch (e: any) { setError(e.response?.data?.error || "Löschen fehlgeschlagen."); }
  };

  const linkedMember = members.find((member) => member.userId === form.userId);

  return <main className="mx-auto max-w-7xl p-6 text-slate-100">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Mitarbeiter</h1><p className="text-sm text-slate-400">Kontaktdaten und KI-Routing pro Organisation verwalten.</p></div>
      <button onClick={createNew} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium"><Plus size={16}/>Mitarbeiter hinzufügen</button>
    </div>
    {error && <p className="mb-4 rounded-lg bg-red-950/50 p-3 text-sm text-red-300">{error}</p>}
    {notice && <p className="mb-4 rounded-lg bg-emerald-950/50 p-3 text-sm text-emerald-300">{notice}</p>}
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <aside className="rounded-xl border border-slate-800 bg-slate-900 p-3">
        <div className="space-y-2">
          {employees.length === 0 && <p className="p-3 text-sm text-slate-500">Noch keine Mitarbeiter angelegt.</p>}
          {employees.map((employee) => <button key={employee.id} onClick={() => select(employee)} className={`w-full rounded-lg border p-3 text-left ${selectedId === employee.id ? "border-blue-500 bg-blue-950/30" : "border-slate-800 bg-slate-950"}`}>
            <div className="flex items-center gap-2"><UserRound size={16}/><b>{employee.displayName}</b></div>
            <p className="mt-1 text-xs text-slate-400">{employee.jobTitle || employee.department || "Keine Rolle hinterlegt"}</p>
          </button>)}
        </div>
      </aside>
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name"><input className={inputClass} value={form.displayName} onChange={(e) => change("displayName", e.target.value)}/></Field>
          <Field label="Relvona-Benutzer"><select className={inputClass} value={form.userId || ""} onChange={(e) => change("userId", e.target.value || null)}><option value="">Nicht verknüpft</option>{members.map((member) => <option key={member.userId} value={member.userId}>{member.name} · {member.email} ({member.role})</option>)}</select></Field>
          <Field label="E-Mail"><input className={inputClass} type="email" value={form.email || ""} onChange={(e) => change("email", e.target.value)}/></Field>
          <Field label="Telefonnummer"><input className={inputClass} value={form.phone || ""} onChange={(e) => change("phone", e.target.value)}/></Field>
          <Field label="Abteilung"><input className={inputClass} value={form.department || ""} onChange={(e) => change("department", e.target.value)}/></Field>
          <Field label="Position / Rolle"><input className={inputClass} value={form.jobTitle || ""} onChange={(e) => change("jobTitle", e.target.value)}/></Field>
          <Field label="Skills (Komma-getrennt)"><input className={inputClass} value={form.skills.join(", ")} onChange={(e) => change("skills", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))}/></Field>
          <Field label="Interne Notiz"><textarea className={inputClass} rows={3} value={form.notes || ""} onChange={(e) => change("notes", e.target.value)}/></Field>
        </div>
        <div className="mt-5 grid gap-3 rounded-lg border border-slate-800 bg-slate-950 p-4 md:grid-cols-2">
          <Toggle label="Für KI auffindbar" checked={form.aiVisible} onChange={(v) => change("aiVisible", v)}/>
          <Toggle label="Aktiv" checked={form.enabled} onChange={(v) => change("enabled", v)}/>
          <Toggle label="E-Mail darf dem Kunden genannt werden" checked={form.exposeEmailToCustomer} onChange={(v) => change("exposeEmailToCustomer", v)}/>
          <Toggle label="Telefonnummer darf dem Kunden genannt werden" checked={form.exposePhoneToCustomer} onChange={(v) => change("exposePhoneToCustomer", v)}/>
          <Toggle label="Direkte Weiterleitung erlauben" checked={form.allowDirectHandoff} onChange={(v) => change("allowDirectHandoff", v)} disabled={!form.userId}/>
        </div>
        {form.allowDirectHandoff && !linkedMember && <p className="mt-3 text-sm text-amber-300">Für eine direkte Weiterleitung muss ein Relvona-Benutzer verknüpft sein.</p>}
        <p className="mt-4 text-xs text-slate-500">Die KI erhält nur freigegebene Mitarbeiter. E-Mail und Telefonnummer werden nur ausgegeben, wenn die jeweilige Freigabe aktiviert ist.</p>
        <div className="mt-6 flex gap-3"><button disabled={saving} onClick={save} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium disabled:opacity-50"><Save size={16}/>{saving ? "Speichert …" : "Speichern"}</button>{form.id && <button onClick={remove} className="inline-flex items-center gap-2 rounded-lg border border-red-800 px-4 py-2 text-sm text-red-300"><Trash2 size={16}/>Löschen</button>}</div>
      </section>
    </div>
  </main>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="space-y-1.5 text-sm"><span className="font-medium text-slate-300">{label}</span>{children}</label>; }
function Toggle({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) { return <label className={`flex items-center gap-2 text-sm ${disabled ? "opacity-50" : ""}`}><input type="checkbox" disabled={disabled} checked={checked} onChange={(e) => onChange(e.target.checked)}/><span>{label}</span></label>; }
