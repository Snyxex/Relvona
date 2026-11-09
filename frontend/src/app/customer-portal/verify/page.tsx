"use client";
import AccessShell from "@/components/access-shell";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE_URL } from "@/lib/api";

export default function CustomerPortalVerifyPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Anmeldelink wird geprüft …");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setMessage("Der Anmeldelink ist ungültig.");
      return;
    }
    void fetch(`${API_BASE_URL}/customer-portal/verify`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        router.replace("/customer-portal");
      })
      .catch(() => setMessage("Der Anmeldelink ist ungültig oder abgelaufen."));
  }, [router]);

  return (
    <AccessShell
      title="Anmeldelink prüfen"
      description="Dein Zugang zum Kundenportal wird bestätigt."
      eyebrow="KUNDENPORTAL"
    >
      <p role="status" className="rv-access-status">
        {message}
      </p>
      <a className="rv-access-link" href="/customer-portal">
        Neuen Anmeldelink anfordern
      </a>
    </AccessShell>
  );
}
