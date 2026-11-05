"use client";

import type { Dispatch, FormEventHandler, SetStateAction } from "react";
import {
  BookOpen,
  FileText,
  Globe,
  Plus,
  RefreshCw,
  Upload,
} from "lucide-react";
import KnowledgeSources, {
  type KnowledgeSource,
} from "@/components/knowledge-sources";
import { WorkspaceHeader, WorkspaceMetric } from "./workspace-primitives";

export type KnowledgeBase = { id: string; name: string };

type CommonProps = {
  organizationId?: string;
  canManage: boolean;
  knowledgeBases: KnowledgeBase[];
  knowledgeSources: KnowledgeSource[];
  selectedKbId: string;
  setSelectedKbId: Dispatch<SetStateAction<string>>;
  fetchTenantData: () => Promise<void>;
  showNotify: (message: string) => void;
  loading: boolean;
};

type KnowledgeProps = CommonProps & {
  newKbName: string;
  setNewKbName: Dispatch<SetStateAction<string>>;
  handleCreateKnowledgeBase: FormEventHandler<HTMLFormElement>;
  handleAddTextDocument: FormEventHandler<HTMLFormElement>;
  handleUploadPdf: FormEventHandler<HTMLFormElement>;
  docType: "document" | "faq";
  setDocType: Dispatch<SetStateAction<"document" | "faq">>;
  docTitle: string;
  setDocTitle: Dispatch<SetStateAction<string>>;
  docContent: string;
  setDocContent: Dispatch<SetStateAction<string>>;
  docCategory: string;
  setDocCategory: Dispatch<SetStateAction<string>>;
  docLanguage: string;
  setDocLanguage: Dispatch<SetStateAction<string>>;
  pdfFile: File | null;
  setPdfFile: Dispatch<SetStateAction<File | null>>;
};

type CrawlerProps = CommonProps & {
  crawlUrl: string;
  setCrawlUrl: Dispatch<SetStateAction<string>>;
  handleCreateCrawlerKnowledgeBase: () => Promise<void>;
  handleCrawlWebsite: FormEventHandler<HTMLFormElement>;
};

export function KnowledgeWorkspace({
  organizationId,
  canManage,
  knowledgeBases,
  knowledgeSources,
  selectedKbId,
  setSelectedKbId,
  fetchTenantData,
  showNotify,
  loading,
  newKbName,
  setNewKbName,
  handleCreateKnowledgeBase,
  handleAddTextDocument,
  handleUploadPdf,
  docType,
  setDocType,
  docTitle,
  setDocTitle,
  docContent,
  setDocContent,
  docCategory,
  setDocCategory,
  docLanguage,
  setDocLanguage,
  pdfFile,
  setPdfFile,
}: KnowledgeProps) {
  return (
    <div className="rv-knowledge-workspace rv-config-workspace space-y-6 max-w-7xl mx-auto">
      <WorkspaceHeader
        eyebrow="WISSEN"
        title="Wissensdatenbank"
        description="Verwalte Dokumente, FAQs und PDFs als geprüfte Wissensquellen für deine AI."
      >
        <form onSubmit={handleCreateKnowledgeBase} className="flex gap-2">
          <input
            type="text"
            placeholder="Name der neuen Wissensdatenbank"
            className="bg-slate-900 border border-slate-800 rounded px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
            value={newKbName}
            onChange={(e) => setNewKbName(e.target.value)}
          />
          <button
            type="submit"
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> Erstellen
          </button>
        </form>
      </WorkspaceHeader>

      <div className="rv-section-kpis rv-config-kpis">
        <WorkspaceMetric
          label="Wissensdatenbanken"
          value={knowledgeBases.length}
          icon={BookOpen}
          tone="blue"
        />
        <WorkspaceMetric
          label="Wissensquellen"
          value={knowledgeSources.length}
          icon={FileText}
          tone="violet"
        />
        <WorkspaceMetric
          label="Text-Chunks"
          value={knowledgeSources
            .reduce((sum, source) => sum + (Number(source.chunkCount) || 0), 0)
            .toLocaleString("de-DE")}
          icon={Upload}
          tone="mint"
        />
        <WorkspaceMetric
          label="In Verarbeitung"
          value={
            knowledgeSources.filter((source) =>
              ["queued", "processing"].includes(source.status),
            ).length
          }
          icon={RefreshCw}
          tone="amber"
        />
      </div>

      {knowledgeBases.length > 0 && (
        <div className="flex gap-2 border-b border-slate-800 pb-2">
          {knowledgeBases.map((kb) => (
            <button
              type="button"
              key={kb.id}
              onClick={() => setSelectedKbId(kb.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                selectedKbId === kb.id
                  ? "bg-blue-600 text-white"
                  : "bg-slate-900 text-slate-400 hover:bg-slate-800"
              }`}
            >
              {kb.name}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-400" /> Dokumente und FAQ
          </h3>
          <form onSubmit={handleAddTextDocument} className="space-y-3">
            <label className="block text-xs text-slate-400">
              Quellentyp
              <select
                className="block w-full mt-1 p-2 rounded bg-slate-800"
                value={docType}
                onChange={(event) =>
                  setDocType(event.target.value as "document" | "faq")
                }
              >
                <option value="document">Dokument</option>
                <option value="faq">FAQ</option>
              </select>
            </label>
            <div>
              <label
                htmlFor="support-field-10"
                className="block text-xs font-medium text-slate-400 mb-1"
              >
                {docType === "faq" ? "Frage" : "Titel"}
              </label>
              <input
                id="support-field-10"
                type="text"
                required
                placeholder="z. B. Rückgabebedingungen"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none"
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="support-field-11"
                className="block text-xs font-medium text-slate-400 mb-1"
              >
                {docType === "faq" ? "Antwort" : "Inhalt"}
              </label>
              <textarea
                id="support-field-11"
                rows={5}
                required
                placeholder="Dokumententext oder FAQ-Antwort eingeben"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none"
                value={docContent}
                onChange={(e) => setDocContent(e.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <label className="text-xs text-slate-400">
                Kategorie
                <input
                  className="block w-full mt-1 p-2 rounded bg-slate-800"
                  value={docCategory}
                  maxLength={120}
                  onChange={(event) => setDocCategory(event.target.value)}
                />
              </label>
              <label className="text-xs text-slate-400">
                Sprache
                <input
                  className="block w-full mt-1 p-2 rounded bg-slate-800"
                  required
                  pattern="[a-z]{2,3}(-[A-Za-z]{2,8})?"
                  value={docLanguage}
                  onChange={(event) => setDocLanguage(event.target.value)}
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded text-xs transition-colors"
            >
              {loading
                ? "Wird gespeichert …"
                : "Inhalt speichern und verarbeiten"}
            </button>
          </form>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Upload className="w-4 h-4 text-emerald-400" /> PDF-Verarbeitung
          </h3>
          <form onSubmit={handleUploadPdf} className="space-y-3">
            <div>
              <label
                htmlFor="support-field-12"
                className="block text-xs font-medium text-slate-400 mb-1"
              >
                PDF-Datei
              </label>
              <input
                id="support-field-12"
                type="file"
                accept=".pdf"
                required
                onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-xs focus:outline-none text-slate-300"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !pdfFile}
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded text-xs transition-colors"
            >
              {loading
                ? "PDF wird hochgeladen …"
                : "PDF hochladen und verarbeiten"}
            </button>
          </form>
        </div>
      </div>

      <KnowledgeSources
        key={organizationId}
        sources={knowledgeSources}
        canManage={canManage}
        onRefresh={fetchTenantData}
        notify={showNotify}
      />
    </div>
  );
}

export function WebsiteCrawlerWorkspace({
  organizationId,
  canManage,
  knowledgeBases,
  knowledgeSources,
  selectedKbId,
  setSelectedKbId,
  fetchTenantData,
  showNotify,
  loading,
  crawlUrl,
  setCrawlUrl,
  handleCreateCrawlerKnowledgeBase,
  handleCrawlWebsite,
}: CrawlerProps) {
  return (
    <div className="rv-crawler-workspace rv-config-workspace space-y-6 max-w-7xl mx-auto">
      <WorkspaceHeader
        eyebrow="QUELLEN"
        title="Website-Crawler"
        description="Indexiere öffentliche Webseiten mit SSRF-Schutz und automatischer Textverarbeitung."
      />

      <div className="rv-section-kpis rv-config-kpis">
        <WorkspaceMetric
          label="Webseitenquellen"
          value={
            knowledgeSources.filter((source) => source.type === "website")
              .length
          }
          icon={Globe}
          tone="blue"
        />
        <WorkspaceMetric
          label="Erfolgreich indexiert"
          value={
            knowledgeSources.filter(
              (source) =>
                source.type === "website" && source.status === "completed",
            ).length
          }
          icon={FileText}
          tone="mint"
        />
        <WorkspaceMetric
          label="In Verarbeitung"
          value={
            knowledgeSources.filter(
              (source) =>
                source.type === "website" &&
                ["queued", "processing"].includes(source.status),
            ).length
          }
          icon={RefreshCw}
          tone="amber"
        />
      </div>

      <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl max-w-xl space-y-4">
        <form onSubmit={handleCrawlWebsite} className="space-y-3">
          <div>
            <label
              htmlFor="support-field-13"
              className="block text-xs font-medium text-slate-400 mb-1"
            >
              Wissensdatenbank
            </label>
            <select
              id="support-field-13"
              required
              value={selectedKbId}
              onChange={(e) => setSelectedKbId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none"
            >
              <option value="">Wissensdatenbank auswählen</option>
              {knowledgeBases.map((knowledgeBase) => (
                <option key={knowledgeBase.id} value={knowledgeBase.id}>
                  {knowledgeBase.name}
                </option>
              ))}
            </select>
            {knowledgeBases.length === 0 && (
              <div className="mt-2 flex items-center justify-between gap-3 rounded border border-amber-900/70 bg-amber-950/20 p-3">
                <p className="text-[10px] text-amber-300">
                  Noch keine Wissensdatenbank vorhanden.
                </p>
                <button
                  type="button"
                  onClick={handleCreateCrawlerKnowledgeBase}
                  disabled={loading}
                  className="shrink-0 rounded bg-amber-600 px-2.5 py-1.5 text-[10px] font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
                >
                  Jetzt erstellen
                </button>
              </div>
            )}
          </div>
          <div>
            <label
              htmlFor="support-field-14"
              className="block text-xs font-medium text-slate-400 mb-1"
            >
              Website-Startadresse
            </label>
            <input
              id="support-field-14"
              type="url"
              required
              placeholder="https://docs.yourcompany.com"
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none"
              value={crawlUrl}
              onChange={(e) => setCrawlUrl(e.target.value)}
            />
            <p className="text-[10px] text-slate-500 mt-1">
              SSRF-Schutz: Private IP-Adressbereiche werden serverseitig
              blockiert.
            </p>
          </div>
          <button
            type="submit"
            disabled={loading || !selectedKbId}
            className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded text-xs transition-colors"
          >
            {loading ? "Crawler wird gestartet …" : "Website indexieren"}
          </button>
        </form>
      </div>

      <KnowledgeSources
        key={organizationId}
        sources={knowledgeSources.filter((source) => source.type === "website")}
        canManage={canManage}
        onRefresh={fetchTenantData}
        notify={showNotify}
      />
    </div>
  );
}
