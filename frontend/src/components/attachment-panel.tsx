"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, File, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import {
  deleteAttachment,
  downloadAttachment,
  formatAttachmentSize,
  listAttachments,
  type AttachmentListItem,
  type AttachmentParentType,
  type AttachmentVisibility,
  uploadAttachment,
} from "@/lib/attachments";

export default function AttachmentPanel({
  parentType,
  parentId,
  allowCustomerVisible = false,
}: {
  parentType: AttachmentParentType;
  parentId: string;
  allowCustomerVisible?: boolean;
}) {
  const [items, setItems] = useState<AttachmentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<AttachmentVisibility>("INTERNAL_ONLY");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setItems(await listAttachments(parentType, parentId));
    } catch {
      setError("Anhänge konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [parentId, parentType]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const created = await uploadAttachment({ parentType, parentId, file, visibility });
      setItems((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("TYPE_NOT_ALLOWED")) setError("Dieser Dateityp ist nicht erlaubt.");
      else if (message.includes("SIZE_INVALID")) setError("Dateien dürfen maximal 10 MB groß sein.");
      else setError("Upload fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (item: AttachmentListItem) => {
    setDeletingId(item.id);
    setError(null);
    try {
      await deleteAttachment(item.id);
      setItems((current) => current.filter((entry) => entry.id !== item.id));
    } catch {
      setError("Anhang konnte nicht gelöscht werden.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-slate-400" />
          <div>
            <h4 className="font-semibold text-slate-200">Anhänge</h4>
            <p className="text-[10px] text-slate-500">PDF, PNG, JPEG, WebP, TXT oder CSV · max. 10 MB</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {allowCustomerVisible && (
            <select
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as AttachmentVisibility)}
              disabled={uploading}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-[10px] text-slate-200"
            >
              <option value="INTERNAL_ONLY">Nur intern</option>
              <option value="CUSTOMER_VISIBLE">Für Kunden sichtbar</option>
            </select>
          )}
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept="application/pdf,image/png,image/jpeg,image/webp,text/plain,text/csv,.pdf,.png,.jpg,.jpeg,.webp,.txt,.csv"
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-2.5 py-1.5 font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {uploading ? "Upload…" : "Datei hinzufügen"}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 rounded border border-red-900/70 bg-red-950/30 px-2.5 py-2 text-red-300">{error}</p>}

      <div className="mt-3 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 py-2 text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Anhänge werden geladen…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-800 px-3 py-4 text-center text-slate-500">
            Noch keine Anhänge.
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-800">
                <File className="h-4 w-4 text-slate-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-200" title={item.originalFilename}>{item.originalFilename}</p>
                <p className="text-[10px] text-slate-500">
                  {formatAttachmentSize(item.fileSize)} · {item.visibility === "CUSTOMER_VISIBLE" ? "kundensichtbar" : "intern"} · {new Date(item.createdAt).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void downloadAttachment(item.id)}
                className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                title="Herunterladen"
              >
                <Download className="h-4 w-4" />
              </button>
              {item.canDelete && (
                <button
                  type="button"
                  disabled={deletingId === item.id}
                  onClick={() => void remove(item)}
                  className="rounded p-1.5 text-slate-500 hover:bg-red-950/40 hover:text-red-300 disabled:opacity-50"
                  title="Löschen"
                >
                  {deletingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
