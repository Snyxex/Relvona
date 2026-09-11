"use client";

import { Bell, CheckCheck, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type NotificationItem = {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  resourceType: string | null;
  resourceId: string | null;
  readAt: string | null;
  createdAt: string;
};

export default function NotificationCenter() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!localStorage.getItem("active_org_id")) return;
    try {
      const { data } = await api.get("/notifications?limit=30");
      setItems(Array.isArray(data?.notifications) ? data.notifications : []);
      setUnread(Number(data?.unread || 0));
    } catch {
      // Notification polling must never block the dashboard.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    const onStorage = (event: StorageEvent) => {
      if (event.key === "active_org_id") void load();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
    };
  }, [load]);

  async function markRead(id: string) {
    const item = items.find((entry) => entry.id === id);
    if (!item || item.readAt) return;
    try {
      await api.post(`/notifications/${id}/read`);
      setItems((current) => current.map((entry) => entry.id === id ? { ...entry, readAt: new Date().toISOString() } : entry));
      setUnread((current) => Math.max(0, current - 1));
    } catch {}
  }

  async function markAllRead() {
    try {
      await api.post("/notifications/read-all");
      const now = new Date().toISOString();
      setItems((current) => current.map((entry) => ({ ...entry, readAt: entry.readAt || now })));
      setUnread(0);
    } catch {}
  }

  return (
    <div className="fixed right-5 top-5 z-[60]">
      <button
        type="button"
        onClick={() => { setOpen((value) => !value); if (!open) void load(); }}
        className="relative grid h-11 w-11 place-items-center rounded-full border border-slate-700 bg-slate-950 text-slate-200 shadow-xl transition hover:bg-slate-900"
        aria-label="Benachrichtigungen"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[10px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>}
      </button>

      {open && (
        <div className="mt-2 w-[min(92vw,390px)] overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 text-slate-100 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Benachrichtigungen</h2>
              <p className="text-xs text-slate-500">{unread} ungelesen</p>
            </div>
            <div className="flex items-center gap-1">
              {unread > 0 && <button type="button" onClick={() => void markAllRead()} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Alle als gelesen markieren"><CheckCheck className="h-4 w-4" /></button>}
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Schließen"><X className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {items.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-500">Keine Benachrichtigungen.</p>}
            {items.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => void markRead(item.id)}
                className={`block w-full border-b border-slate-900 px-4 py-3 text-left transition hover:bg-slate-900/70 ${item.readAt ? "opacity-60" : "bg-slate-900/30"}`}
              >
                <div className="flex items-start gap-3">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.severity === "warning" ? "bg-amber-400" : "bg-blue-400"}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-100">{item.title}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-400">{item.message}</p>
                    <p className="mt-1.5 text-[10px] text-slate-600">{new Date(item.createdAt).toLocaleString("de-DE")}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
