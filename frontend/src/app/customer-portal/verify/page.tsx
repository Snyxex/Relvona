"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE_URL } from "@/lib/api";

export default function CustomerPortalVerifyPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Anmeldelink wird geprüft …");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) { setMessage("Der Anmeldelink ist ungültig."); return; }
    void fetch(`${API_BASE_URL}/customer-portal/verify`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).then(async (response) => {
      if (!response.ok) throw new Error();
      router.replace("/customer-portal");
    }).catch(() => setMessage("Der Anmeldelink ist ungültig oder abgelaufen."));
  }, [router]);

  return <main className="flex min-h-screen items-center justify-center bg-background p-6"><div className="max-w-md rounded-xl border bg-card p-6 text-center"><h1 className="text-xl font-semibold">Kundenportal</h1><p className="mt-3 text-sm text-muted-foreground">{message}</p></div></main>;
}
