"use client";

import dynamic from "next/dynamic";
import AccessShell from "@/components/access-shell";
import { useEffect, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import AttachmentPanel from "@/components/attachment-panel";
import NotificationCenter from "@/components/notification-center";
import {
  ATTACHMENT_CONTEXT_EVENT,
  type ActiveAttachmentContext,
} from "@/lib/api";

const Dashboard = dynamic(() => import("@/components/dashboard"), {
  ssr: false,
  loading: () => (
    <AccessShell
      title="Arbeitsbereich wird vorbereitet"
      description="Dein Relvona-Arbeitsbereich und deine Organisationsdaten werden geladen."
    >
      <p role="status" className="rv-access-status">
        Relvona wird geladen …
      </p>
    </AccessShell>
  ),
});

export default function DashboardLoader({
  administration = false,
  initialTab,
}: {
  administration?: boolean;
  initialTab?: "profile";
}) {
  const [attachmentContext, setAttachmentContext] =
    useState<ActiveAttachmentContext | null>(null);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const attachmentContextRef = useRef<ActiveAttachmentContext | null>(null);

  useEffect(() => {
    const onContext = (event: Event) => {
      const detail = (event as CustomEvent<ActiveAttachmentContext>).detail;
      if (!detail || !["conversation", "ticket"].includes(detail.parentType))
        return;
      if (!/^[0-9a-f-]{36}$/i.test(detail.parentId)) return;
      const current = attachmentContextRef.current;
      const changed =
        !current ||
        current.parentType !== detail.parentType ||
        current.parentId !== detail.parentId;
      if (!changed) return;
      attachmentContextRef.current = detail;
      setAttachmentContext(detail);
      setAttachmentOpen(false);
    };
    window.addEventListener(ATTACHMENT_CONTEXT_EVENT, onContext);
    return () =>
      window.removeEventListener(ATTACHMENT_CONTEXT_EVENT, onContext);
  }, []);

  return (
    <>
      <Dashboard administration={administration} initialTab={initialTab} />
      {!administration && <NotificationCenter />}
      {!administration && attachmentContext && (
        <>
          {!attachmentOpen && (
            <button
              type="button"
              onClick={() => setAttachmentOpen(true)}
              className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-4 py-2.5 text-xs font-semibold text-slate-100 shadow-2xl transition hover:bg-slate-800"
              aria-label="Anhänge öffnen"
            >
              <Paperclip className="h-4 w-4" />
              Anhänge
            </button>
          )}
          {attachmentOpen && (
            <div className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-[1px]">
              <button
                type="button"
                className="absolute inset-0"
                aria-label="Anhangbereich schließen"
                onClick={() => setAttachmentOpen(false)}
              />
              <aside
                className="rv-app-surface relative h-full w-full max-w-md overflow-y-auto border-l border-slate-800 bg-slate-950 p-4 shadow-2xl"
                aria-label="Anhänge"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                      {attachmentContext.parentType === "ticket"
                        ? "Ticket"
                        : "Conversation"}
                    </p>
                    <h2 className="text-sm font-semibold text-slate-100">
                      Anhänge
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAttachmentOpen(false)}
                    className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                    aria-label="Anhänge schließen"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <AttachmentPanel
                  key={`${attachmentContext.parentType}:${attachmentContext.parentId}`}
                  parentType={attachmentContext.parentType}
                  parentId={attachmentContext.parentId}
                  allowCustomerVisible={
                    attachmentContext.parentType === "ticket"
                  }
                />
              </aside>
            </div>
          )}
        </>
      )}
    </>
  );
}
