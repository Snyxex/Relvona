"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Globe,
  MessageSquare,
  Ticket,
  CheckCircle,
  AlertCircle,
  Users,
  LogOut,
  CalendarDays,
  Workflow,
} from "lucide-react";
import ProfileSecuritySettings from "@/components/profile-security-settings";
import OrganizationSettings from "@/components/dashboard-tabs/organization-settings";
import WidgetDesigner from "@/components/dashboard-tabs/widget-designer";
import AssistantSettings from "@/components/dashboard-tabs/assistant-settings";
import TicketsWorkspace from "@/components/dashboard-tabs/tickets-workspace";
import ConversationsWorkspace from "@/components/dashboard-tabs/conversations-workspace";
import { useConversationRealtime } from "@/hooks/use-conversation-realtime";
import { KnowledgeWorkspace, WebsiteCrawlerWorkspace, type KnowledgeBase } from "@/components/dashboard-tabs/knowledge-workspaces";
import type { KnowledgeSource } from "@/components/knowledge-sources";
import { WorkspaceEmpty, WorkspaceHeader } from "@/components/dashboard-tabs/workspace-primitives";
import {
  LazyAgentsTab,
  LazyAnalyticsTab,
  LazyCustomersTab,
  LazyOverviewTab,
} from "@/components/dashboard-tabs/lazy-tabs";
import { api } from "@/lib/api";
import { type DashboardTab, dashboardNavigation } from "@/lib/dashboard-navigation";
import { authClient } from "@/lib/auth-client";
import {
  type DashboardLanguage,
  localizeDashboard,
} from "@/lib/dashboard-i18n";
import {
  applyUserTheme,
  completeUserTheme,
  DEFAULT_USER_THEME,
  LIGHT_USER_THEME,
  type UserThemePreferences,
} from "@/lib/user-theme";


export default function Dashboard({
  administration = false,
  initialTab,
}: {
  administration?: boolean;
  initialTab?: "profile";
}) {
  const [auth, setAuth] = useState<{
    user: any;
    organizations: any[];
  } | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [activeOrg, setActiveOrg] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<DashboardTab>(initialTab ?? (administration ? "assistant" : "overview"));

  // Auth Form State
  const [isRegistering, setIsRegistering] = useState(false);
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authOrgName, setAuthOrgName] = useState("");
  const [authError, setAuthError] = useState("");
  const [awaitingTwoFactor, setAwaitingTwoFactor] = useState(false);
  const [twoFactorLoginCode, setTwoFactorLoginCode] = useState("");

  // Data States
  const [overviewMetrics, setOverviewMetrics] = useState<any>(null);
  const [conversationsList, setConversationsList] = useState<any[]>([]);
  const [selectedConv, setSelectedConv] = useState<any>(null);
  const [convMessages, setConvMessages] = useState<any[]>([]);
  const [agentMsgInput, setAgentMsgInput] = useState("");
  const [internalNoteInput, setInternalNoteInput] = useState("");
  const [inboxState, setInboxState] = useState("");
  const [inboxPriority, setInboxPriority] = useState("");
  const [inboxAgentId, setInboxAgentId] = useState("");
  const [inboxFrom, setInboxFrom] = useState("");
  const [inboxTo, setInboxTo] = useState("");
  const [inboxSearch, setInboxSearch] = useState("");
  const [debouncedInboxSearch, setDebouncedInboxSearch] = useState("");
  const [inboxSort, setInboxSort] = useState("newest");
  const [inboxTags, setInboxTags] = useState<any[]>([]);
  const [inboxAgents, setInboxAgents] = useState<any[]>([]);
  const [agentPresence, setAgentPresence] = useState("OFFLINE");
  const [presenceLoaded, setPresenceLoaded] = useState(false);
  const [inboxTagId, setInboxTagId] = useState("");
  const [inboxTimeline, setInboxTimeline] = useState<any[]>([]);
  const [inboxHandoff, setInboxHandoff] = useState<any | null>(null);
  const [suggestion, setSuggestion] = useState<{
    content: string;
    sources: string[];
    conversationId: string;
  } | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [connected, setConnected] = useState(false);
  const selectedConversationId = useRef<string | undefined>(undefined);
  const conversationDetailRequestId = useRef(0);
  const suggestionRequestId = useRef(0);
  selectedConversationId.current = selectedConv?.id;

  const [ticketsList, setTicketsList] = useState<any[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [ticketCommentsList, setTicketCommentsList] = useState<any[]>([]);
  const [commentInput, setCommentInput] = useState("");

  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>([]);
  const [assistantsList, setAssistantsList] = useState<any[]>([]);
  const [activeAssistant, setActiveAssistant] = useState<any>(null);
  const [agentsList, setAgentsList] = useState<any[]>([]);
  const [customersList, setCustomersList] = useState<any[]>([]);

  // Input States
  const [newKbName, setNewKbName] = useState("");
  const [selectedKbId, setSelectedKbId] = useState("");
  const [docTitle, setDocTitle] = useState("");
  const [docContent, setDocContent] = useState("");
  const [docType, setDocType] = useState<"document" | "faq">("document");
  const [docCategory, setDocCategory] = useState("");
  const [docLanguage, setDocLanguage] = useState("de");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [crawlUrl, setCrawlUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [preferredLanguage, setPreferredLanguage] = useState("de");
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [profileName, setProfileName] = useState("");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [themePreferences, setThemePreferences] = useState<UserThemePreferences>(
    DEFAULT_USER_THEME,
  );

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      const activeOrgId = localStorage.getItem("active_org_id");
      try {
        const bootstrap = await api.get("/auth/bootstrap-status");
        if (bootstrap.data.required) {
          active = false;
          window.location.replace("/setup/platform-admin");
          return;
        }
        const session = await authClient.getSession();
        if (session.error || !session.data?.user) return;
        if (administration) {
          const [me, list] = await Promise.all([
            api.get("/auth/me"),
            api.get("/admin/organizations"),
          ]);
          if (!active) return;
          const orgs = list.data.map((org: any) => ({ ...org, role: "admin" }));
          const user = me.data.user;
          setAuth({ user, organizations: orgs });
          setPreferredLanguage(user.preferredLanguage || "de");
          setProfileName(user.name || "");
          setProfileAvatarUrl(user.avatarUrl || null);
          setThemePreferences(completeUserTheme(user.themePreferences));
          setActiveOrg(orgs.find((org: any) => org.id === activeOrgId) || orgs[0]);
          return;
        }
        const [me, memberships] = await Promise.all([
          api.get("/auth/me"),
          api.get("/auth/organizations"),
        ]);
        if (!active) return;
        const user = me.data.user;
        const orgs = memberships.data;
        setAuth({ user, organizations: orgs });
        setPreferredLanguage(user.preferredLanguage || "de");
        setProfileName(user.name || "");
        setProfileAvatarUrl(user.avatarUrl || null);
        setThemePreferences(completeUserTheme(user.themePreferences));
        const currentOrg = orgs.find((o: any) => o.id === activeOrgId) || orgs[0];
        if (currentOrg) {
          setActiveOrg(currentOrg);
          localStorage.setItem("active_org_id", currentOrg.id);
        }
      } catch {
        if (active) setAuth(null);
      } finally {
        if (active) setAuthChecking(false);
      }
    };
    void initialize();
    return () => {
      active = false;
    };
  }, [administration]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedInboxSearch(inboxSearch), 350);
    return () => window.clearTimeout(timer);
  }, [inboxSearch]);

  // A visible, authenticated dashboard provides the freshness signal for routing.
  // Persisted AWAY/OFFLINE values are never overridden by a heartbeat.
  useEffect(() => {
    const userId = auth?.user?.id;
    if (administration || !userId || !activeOrg?.id) return;
    let mounted = true;
    setPresenceLoaded(false);
    void api.get("/conversations/meta/agents").then(({ data }) => {
      if (!mounted) return;
      const status = data.find((agent: { id: string; presence?: string }) => agent.id === userId)?.presence;
      setAgentPresence(["ONLINE", "AWAY", "OFFLINE"].includes(status) ? status : "OFFLINE");
      setPresenceLoaded(true);
    }).catch(() => {
      if (mounted) { setAgentPresence("OFFLINE"); setPresenceLoaded(false); }
    });
    return () => { mounted = false; };
  }, [administration, auth?.user?.id, activeOrg?.id]);

  useEffect(() => {
    if (administration || !presenceLoaded || agentPresence !== "ONLINE" || !activeOrg?.id) return;
    const heartbeat = () => {
      if (document.visibilityState !== "visible") return;
      void api.put("/conversations/meta/presence", { status: "ONLINE" }).catch(() => undefined);
    };
    heartbeat();
    const id = window.setInterval(heartbeat, 60_000);
    return () => window.clearInterval(id);
  }, [administration, presenceLoaded, agentPresence, activeOrg?.id]);

  useEffect(() => {
    applyUserTheme(themePreferences);
  }, [themePreferences]);

  useEffect(() => {
    const language = preferredLanguage as DashboardLanguage;
    const updateLanguage = () => localizeDashboard(language);
    updateLanguage();
    const observer = new MutationObserver(updateLanguage);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [preferredLanguage]);

  useConversationRealtime({
    enabled: Boolean(auth) && activeTab === "conversations",
    organizationId: activeOrg?.id,
    conversationId: selectedConv?.id,
    conversationOrganizationId: selectedConv?.organizationId,
    setMessages: setConvMessages,
    setConnected,
    setNotification,
  });


  const showNotify = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4000);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    try {
      const result = await authClient.signIn.email({
        email: authEmail,
        password: authPassword,
      });
      if (result.error)
        throw new Error(result.error.message || "Anmeldung fehlgeschlagen.");
      if ((result.data as any)?.twoFactorRedirect) {
        setAwaitingTwoFactor(true);
        setAuthPassword("");
        return;
      }
      const [me, memberships] = await Promise.all([
        api.get("/auth/me"),
        api.get("/auth/organizations"),
      ]);
      const user = me.data.user;
      const organizations = memberships.data;

      setAuth({ user, organizations });
      setPreferredLanguage(user.preferredLanguage || "de");
      setProfileName(user.name || "");
      setProfileAvatarUrl(user.avatarUrl || null);
      setThemePreferences(completeUserTheme(user.themePreferences));
      if (organizations.length > 0) {
        setActiveOrg(organizations[0]);
        localStorage.setItem("active_org_id", organizations[0].id);
      }
      if (user.systemRole === "superadmin") window.location.assign("/admin");
      showNotify(`Welcome back, ${user.name}!`);
    } catch (err: any) {
      setAuthError(
        err.response?.data?.error ||
          "Login failed. Please check your credentials.",
      );
    }
  };

  const handleTwoFactorLogin = async () => {
    setAuthError("");
    try {
      const result = await authClient.twoFactor.verifyTotp({ code: twoFactorLoginCode, trustDevice: true });
      if (result.error) throw new Error(result.error.message || "Der Authenticator-Code ist ungültig.");
      const { data } = await api.get("/auth/me");
      window.location.assign(data.user.systemRole === "superadmin" ? "/admin" : "/");
    } catch (error: any) {
      setAuthError(error.message || "2FA-Bestätigung fehlgeschlagen.");
    }
  };

  const handleLogout = async () => {
    await authClient.signOut();
    localStorage.removeItem("active_org_id");
    setAuth(null);
    setActiveOrg(null);
  };

  // Public registration is deliberately unavailable. Accounts are provisioned
  // by an invitation or the one-time platform bootstrap flow.
  const handleRegister = (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError(
      "Öffentliche Registrierung ist deaktiviert. Verwenden Sie eine Organisationseinladung.",
    );
  };

  // A response belongs to both a specific organization and a specific load.
  // Older requests must not overwrite newer filter/organization results.
  const tenantFetchEpoch = useRef(0);
  const activeOrgIdRef = useRef<string | undefined>(activeOrg?.id);
  activeOrgIdRef.current = activeOrg?.id;

  const fetchTenantData = useCallback(async () => {
    const requestedOrgId: string | undefined = activeOrg?.id;
    if (!requestedOrgId) return;
    const epoch = ++tenantFetchEpoch.current;
    const isFresh = () =>
      epoch === tenantFetchEpoch.current && activeOrgIdRef.current === requestedOrgId;
    try {
      if (activeTab === "overview" || activeTab === "analytics") {
        const res = await api.get("/analytics/overview");
        if (isFresh()) setOverviewMetrics(res.data);
      }

      if (activeTab === "conversations") {
        const res = await api.get("/conversations", {
          params: {
            state: inboxState || undefined,
            priority: inboxPriority || undefined,
            agentId: inboxAgentId || undefined,
            tagId: inboxTagId || undefined,
            from: inboxFrom || undefined,
            to: inboxTo || undefined,
            q: debouncedInboxSearch || undefined,
            sort: inboxSort,
          },
        });
        if (!isFresh()) return;
        setConversationsList(res.data);
        const [tags, agents] = await Promise.all([
          api.get("/conversations/meta/tags"),
          api.get("/conversations/meta/agents"),
        ]);
        if (!isFresh()) return;
        setInboxTags(tags.data);
        setInboxAgents(agents.data);
        const ownPresence = agents.data.find(
          (agent: any) => agent.id === auth?.user?.id,
        )?.presence;
        if (ownPresence) setAgentPresence(ownPresence);
      }

      if (activeTab === "tickets") {
        const res = await api.get("/tickets");
        if (isFresh()) setTicketsList(res.data);
      }

      if (activeTab === "knowledge" || activeTab === "websites") {
        const [kbRes, srcRes] = await Promise.all([
          api.get("/knowledge/bases"),
          api.get("/knowledge/sources"),
        ]);
        if (!isFresh()) return;
        setKnowledgeBases(kbRes.data);
        setKnowledgeSources(srcRes.data);
        if (kbRes.data.length > 0 && !selectedKbId) {
          setSelectedKbId(kbRes.data[0].id);
        }
      }

      if (activeTab === "assistant" || activeTab === "widget") {
        const res = await api.get("/assistants");
        if (!isFresh()) return;
        setAssistantsList(res.data);
        setActiveAssistant(res.data[0] ?? null);
      }

      if (activeTab === "agents") {
        const res = await api.get("/agents");
        if (isFresh()) setAgentsList(res.data);
      }

      if (activeTab === "customers") {
        const res = await api.get("/customers");
        if (isFresh()) setCustomersList(res.data);
      }
    } catch (err: any) {
      if (isFresh()) console.error("Failed to load tenant data", err);
    }
  }, [
    activeTab,
    selectedKbId,
    inboxState,
    inboxPriority,
    inboxAgentId,
    inboxFrom,
    inboxTo,
    debouncedInboxSearch,
    inboxSort,
    inboxTagId,
    auth?.user?.id,
    activeOrg?.id,
  ]);

  useEffect(() => {
    if (auth && activeOrg) void fetchTenantData();
    return () => {
      // Invalidate requests during tab/filter changes and unmount.
      tenantFetchEpoch.current += 1;
    };
  }, [auth, activeOrg, fetchTenantData]);

  // --- Handlers for Data Actions ---

  const handleCreateKnowledgeBase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKbName) return;
    try {
      const res = await api.post("/knowledge/bases", { name: newKbName });
      setKnowledgeBases([res.data, ...knowledgeBases]);
      setSelectedKbId(res.data.id);
      setNewKbName("");
      showNotify("Knowledge Base created!");
    } catch (err: any) {
      showNotify(
        err.response?.data?.error || "Failed to create knowledge base",
      );
    }
  };

  const handleCreateCrawlerKnowledgeBase = async () => {
    setLoading(true);
    try {
      const res = await api.post("/knowledge/bases", {
        name: "Website-Wissensdatenbank",
        description: "Automatisch für Website-Crawls angelegt.",
      });
      setKnowledgeBases([res.data, ...knowledgeBases]);
      setSelectedKbId(res.data.id);
      showNotify("Wissensdatenbank erstellt und für den Crawl ausgewählt.");
    } catch (err: any) {
      showNotify(
        err.response?.data?.error ||
          "Wissensdatenbank konnte nicht erstellt werden",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleAddTextDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedKbId || !docTitle || !docContent) return;
    setLoading(true);
    try {
      await api.post("/knowledge/text", {
        knowledgeBaseId: selectedKbId,
        title: docTitle,
        type: docType,
        category: docCategory,
        language: docLanguage,
        content: docContent,
      });
      setDocTitle("");
      setDocContent("");
      showNotify("Dokument gespeichert. Verarbeitung wurde vorgemerkt.");
      void fetchTenantData();
    } catch (err: any) {
      showNotify(err.response?.data?.error || "Ingestion failed");
    } finally {
      setLoading(false);
    }
  };

  const handleUploadPdf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedKbId || !pdfFile) return;
    setLoading(true);
    const formData = new FormData();
    formData.append("file", pdfFile);
    formData.append("knowledgeBaseId", selectedKbId);
    formData.append("title", docTitle || pdfFile.name);

    try {
      await api.post("/knowledge/pdf", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setPdfFile(null);
      setDocTitle("");
      showNotify("PDF gespeichert. Verarbeitung wurde vorgemerkt.");
      void fetchTenantData();
    } catch (err: any) {
      showNotify(err.response?.data?.error || "PDF Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const handleCrawlWebsite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedKbId) {
      showNotify("Erstelle oder wähle zuerst eine Wissensdatenbank aus.");
      return;
    }
    if (!crawlUrl) return;
    setLoading(true);
    try {
      await api.post("/knowledge/crawl", {
        knowledgeBaseId: selectedKbId,
        targetUrl: crawlUrl,
      });
      setCrawlUrl("");
      showNotify("Website-Crawl wurde vorgemerkt.");
      void fetchTenantData();
    } catch (err: any) {
      showNotify(err.response?.data?.error || "Crawl request failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectConversation = async (conv: { id: string; organizationId?: string }) => {
    const organizationId = activeOrgIdRef.current;
    if (!organizationId || (conv.organizationId && conv.organizationId !== organizationId)) return;
    const requestId = ++conversationDetailRequestId.current;
    suggestionRequestId.current += 1;
    selectedConversationId.current = conv.id;
    setSelectedConv(conv);
    setConvMessages([]);
    setInboxTimeline([]);
    setInboxHandoff(null);
    setSuggestion(null);
    setSuggesting(false);
    setTranslations({});
    setAgentMsgInput("");
    setInternalNoteInput("");
    const valid = () =>
      conversationDetailRequestId.current === requestId &&
      activeOrgIdRef.current === organizationId &&
      selectedConversationId.current === conv.id;
    try {
      const [messages, timeline, handoff] = await Promise.all([
        api.get(`/conversations/${conv.id}/messages`),
        api.get(`/conversations/${conv.id}/timeline`),
        api.get(`/conversations/${conv.id}/handoff`).catch(() => null),
      ]);
      if (!valid()) return;
      setConvMessages(messages.data);
      setInboxTimeline(timeline.data);
      setInboxHandoff(handoff?.data || null);
    } catch {
      if (valid()) showNotify("Unterhaltungsdetails konnten nicht geladen werden.");
    }
  };

  const handleSuggestReply = async () => {
    if (!selectedConv || suggesting) return;
    const conversationId = selectedConv.id;
    const organizationId = activeOrgIdRef.current;
    const requestId = ++suggestionRequestId.current;
    setSuggesting(true);
    setSuggestion(null);
    const valid = () =>
      suggestionRequestId.current === requestId &&
      selectedConversationId.current === conversationId &&
      activeOrgIdRef.current === organizationId;
    try {
      const { data } = await api.post(`/conversations/${conversationId}/suggested-reply`);
      if (!valid()) return;
      setSuggestion({
        conversationId,
        content: typeof data.content === "string" ? data.content : "",
        sources: Array.isArray(data.sources) ? data.sources.filter((v: unknown): v is string => typeof v === "string") : [],
      });
    } catch {
      if (valid()) showNotify("Antwortvorschlag konnte nicht erstellt werden.");
    } finally {
      if (valid()) setSuggesting(false);
    }
  };

  const handleInboxAction = async (path: string, body?: Record<string, unknown>) => {
    if (!selectedConv) return;
    const selected = selectedConv;
    const organizationId = activeOrgIdRef.current;
    const isCurrent = () =>
      selectedConversationId.current === selected.id &&
      activeOrgIdRef.current === organizationId;
    try {
      const result = await api.put(`/conversations/${selected.id}/${path}`, body);
      if (!isCurrent()) return;
      const updated = { ...selected, ...(result.data || {}) };
      setSelectedConv(updated);
      await handleSelectConversation(updated);
      if (isCurrent()) void fetchTenantData();
    } catch (err: any) {
      if (isCurrent()) showNotify(err.response?.data?.error || "Aktion konnte nicht ausgeführt werden.");
    }
  };

  const handleToggleConversationTag = async (tag: { id: string; name: string }) => {
    if (!selectedConv) return;
    const selected = selectedConv;
    const organizationId = activeOrgIdRef.current;
    const current = () => activeOrgIdRef.current === organizationId &&
      selectedConversationId.current === selected.id;
    const existing = selected.tags || [];
    const nextTags = existing.some((item: { id: string }) => item.id === tag.id)
      ? existing.filter((item: { id: string }) => item.id !== tag.id)
      : [...existing, tag];
    try {
      await api.put(`/conversations/${selected.id}/tags`, {
        tagIds: nextTags.map((item: { id: string }) => item.id),
      });
      if (!current()) return;
      const updated = { ...selected, tags: nextTags };
      setSelectedConv(updated);
      await handleSelectConversation(updated);
      if (current()) void fetchTenantData();
    } catch (err: any) {
      if (current()) showNotify(err.response?.data?.error || "Tags konnten nicht aktualisiert werden.");
    }
  };

  const handlePresenceChange = async (status: string) => {
    if (!["ONLINE", "AWAY", "OFFLINE"].includes(status)) return;
    const organizationId = activeOrgIdRef.current;
    try {
      await api.put("/conversations/meta/presence", { status });
      if (activeOrgIdRef.current !== organizationId) return;
      setAgentPresence(status);
      setPresenceLoaded(true);
      showNotify(`Präsenzstatus: ${status}`);
    } catch (err: any) {
      if (activeOrgIdRef.current === organizationId) {
        showNotify(err.response?.data?.error || "Präsenzstatus konnte nicht gespeichert werden.");
      }
    }
  };

  const handleAddInternalNote = async () => {
    if (!selectedConv || !internalNoteInput.trim()) return;
    const conversationId = selectedConv.id;
    const organizationId = activeOrgIdRef.current;
    const content = internalNoteInput.trim();
    const current = () => selectedConversationId.current === conversationId &&
      activeOrgIdRef.current === organizationId;
    try {
      const { data } = await api.post(`/conversations/${conversationId}/internal-notes`, { content });
      if (!current()) return;
      setConvMessages((messages) => messages.some((m) => m.id === data.id) ? messages : [...messages, data]);
      setInternalNoteInput((value) => value === content ? "" : value);
      showNotify("Interne Notiz gespeichert.");
    } catch (err: any) {
      if (current()) showNotify(err.response?.data?.error || "Notiz konnte nicht gespeichert werden.");
    }
  };

  const handleProfileImage = (file: File | undefined) => {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 1024 * 1024
    ) {
      showNotify("Use a PNG, JPEG, or WebP image up to 1 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      setProfileAvatarUrl(
        typeof reader.result === "string" ? reader.result : null,
      );
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const res = await api.patch("/auth/me/preferences", {
        name: profileName,
        avatarUrl: profileAvatarUrl,
        preferredLanguage,
        themePreferences,
      });
      if (auth) {
        const user = { ...auth.user, ...res.data };
        setAuth({ ...auth, user });
      }
      setThemePreferences(completeUserTheme(res.data.themePreferences));
      showNotify("Profile saved");
    } catch (err: any) {
      showNotify(err.response?.data?.error || "Could not save profile");
    }
  };

  const handleTranslateMessage = async (message: { id: string }) => {
    if (!selectedConv || translations[message.id]) return;
    const conversationId = selectedConv.id;
    const organizationId = activeOrgIdRef.current;
    const targetLanguage = preferredLanguage;
    try {
      const { data } = await api.post(
        `/conversations/${conversationId}/messages/${message.id}/translation`,
        { targetLanguage },
      );
      if (selectedConversationId.current !== conversationId ||
          activeOrgIdRef.current !== organizationId) return;
      setTranslations((current) => ({ ...current, [message.id]: data.translatedContent }));
    } catch (err: any) {
      if (selectedConversationId.current === conversationId &&
          activeOrgIdRef.current === organizationId) {
        showNotify(err.response?.data?.error || "Übersetzung fehlgeschlagen.");
      }
    }
  };

  const handleSendAgentMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConv || !agentMsgInput.trim()) return;
    const conversationId = selectedConv.id;
    const organizationId = activeOrgIdRef.current;
    const content = agentMsgInput.trim();
    const current = () =>
      selectedConversationId.current === conversationId &&
      activeOrgIdRef.current === organizationId;
    try {
      const { data } = await api.post(`/conversations/${conversationId}/messages`, { content });
      if (!current()) return;
      setConvMessages((messages) =>
        messages.some((message) => message.id === data.id) ? messages : [...messages, data],
      );
      setAgentMsgInput((value) => value === content ? "" : value);
      showNotify("Antwort an Kunden gesendet.");
    } catch (err: any) {
      if (current()) showNotify(err.response?.data?.error || "Antwort konnte nicht gesendet werden.");
    }
  };

  const handleResolveConversation = async (convId: string) => {
    const organizationId = activeOrgIdRef.current;
    try {
      await api.post(`/conversations/${convId}/resolve`);
      if (activeOrgIdRef.current !== organizationId) return;
      showNotify("Unterhaltung gelöst.");
      void fetchTenantData();
    } catch (err: any) {
      if (activeOrgIdRef.current === organizationId) {
        showNotify(err.response?.data?.error || "Unterhaltung konnte nicht gelöst werden.");
      }
    }
  };

  const handleSaveAssistantSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAssistant) return;
    try {
      const res = await api.put(
        `/assistants/${activeAssistant.id}`,
        activeAssistant,
      );
      setActiveAssistant(res.data);
      showNotify("Assistant settings saved!");
    } catch (err: any) {
      showNotify(err.response?.data?.error || "Failed to save settings");
    }
  };

  const handleRotateWidgetKey = async () => {
    if (!activeAssistant) return;
    if (!window.confirm("Widget-Schlüssel erneuern? Der bisherige Schlüssel wird ungültig und alle eingebundenen Websites müssen ihren Widget-Key aktualisieren.")) return;
    try {
      const res = await api.post(
        `/assistants/${activeAssistant.id}/widget-key/rotate`,
      );
      setActiveAssistant(res.data);
      setAssistantsList(
        assistantsList.map((assistant) =>
          assistant.id === res.data.id ? res.data : assistant,
        ),
      );
      showNotify(
        "Public widget key rotated. Update every external integration.",
      );
    } catch (err: any) {
      showNotify(err.response?.data?.error || "Failed to rotate widget key");
    }
  };

  const ticketDetailRequestId = useRef(0);
  const handleSelectTicket = async (ticket: { id: string }) => {
    const organizationId = activeOrgIdRef.current;
    const requestId = ++ticketDetailRequestId.current;
    setSelectedTicket(ticket);
    setTicketCommentsList([]);
    try {
      const res = await api.get(`/tickets/${ticket.id}/comments`);
      if (ticketDetailRequestId.current === requestId && activeOrgIdRef.current === organizationId) {
        setTicketCommentsList(res.data);
      }
    } catch (err) {
      if (ticketDetailRequestId.current === requestId && activeOrgIdRef.current === organizationId) {
        console.error("Failed to load ticket comments", err);
      }
    }
  };

  const handleTicketStatusChange = async (status: string) => {
    if (!selectedTicket) return;
    try {
      const res = await api.put(`/tickets/${selectedTicket.id}`, { status });
      setSelectedTicket(res.data);
      setTicketsList((current) =>
        current.map((ticket) =>
          ticket.id === res.data.id ? { ...ticket, ...res.data } : ticket,
        ),
      );
      showNotify(`Ticket #${res.data.ticketNumber} updated`);
    } catch (err: any) {
      showNotify(err.response?.data?.error || "Failed to update ticket");
    }
  };

  const handleAddTicketComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !commentInput.trim()) return;
    try {
      const res = await api.post(`/tickets/${selectedTicket.id}/comments`, {
        content: commentInput.trim(),
        isInternal: true,
      });
      setTicketCommentsList((current) => [
        ...current,
        { ...res.data, author: auth?.user },
      ]);
      setCommentInput("");
      showNotify("Interne Notiz hinzugefügt");
    } catch (err: any) {
      showNotify(
        err.response?.data?.error ||
          "Kommentar konnte nicht gespeichert werden",
      );
    }
  };

  const handleOpenTicketConversation = async () => {
    if (!selectedTicket?.conversationId) {
      showNotify("Diesem Ticket ist keine Unterhaltung zugeordnet.");
      return;
    }
    const organizationId = activeOrgIdRef.current;
    const conversationId = selectedTicket.conversationId;
    try {
      const { data } = await api.get("/conversations");
      if (activeOrgIdRef.current !== organizationId) return;
      const conversation = data.find((item: { id: string }) => item.id === conversationId);
      if (!conversation) {
        showNotify("Die zugehörige Unterhaltung ist nicht mehr verfügbar.");
        return;
      }
      setConversationsList(data);
      setActiveTab("conversations");
      await handleSelectConversation(conversation);
    } catch (err: any) {
      if (activeOrgIdRef.current === organizationId) {
        showNotify(err.response?.data?.error || "Unterhaltung konnte nicht geladen werden.");
      }
    }
  };

  // --- Render Authentication Screen ---
  if (authChecking) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-950 text-slate-100">
        Relvona wird vorbereitet …
      </div>
    );
  }

  if (!auth) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 text-slate-100 font-sans">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-2xl shadow-lg shadow-blue-500/30">
              <Bot className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                SupportAI Platform
              </h1>
              <p className="text-xs text-slate-400">
                Multi-Tenant AI Support Engine
              </p>
            </div>
          </div>

          {authError && (
            <div className="mb-4 p-3 bg-red-950/80 border border-red-800 text-red-200 text-sm rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          {isRegistering ? (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label
                  htmlFor="support-field-1"
                  className="block text-xs font-semibold text-slate-300 uppercase mb-1"
                >
                  Your Full Name
                </label>
                <input
                  id="support-field-1"
                  type="text"
                  required
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  placeholder="Jane Doe"
                />
              </div>
              <div>
                <label
                  htmlFor="support-field-2"
                  className="block text-xs font-semibold text-slate-300 uppercase mb-1"
                >
                  Company / Org Name
                </label>
                <input
                  id="support-field-2"
                  type="text"
                  required
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  value={authOrgName}
                  onChange={(e) => setAuthOrgName(e.target.value)}
                  placeholder="Acme Corp"
                />
              </div>
              <div>
                <label
                  htmlFor="support-field-3"
                  className="block text-xs font-semibold text-slate-300 uppercase mb-1"
                >
                  Work Email
                </label>
                <input
                  id="support-field-3"
                  type="email"
                  required
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="jane@acme.com"
                />
              </div>
              <div>
                <label
                  htmlFor="support-field-4"
                  className="block text-xs font-semibold text-slate-300 uppercase mb-1"
                >
                  Password
                </label>
                <input
                  id="support-field-4"
                  type="password"
                  required
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg text-sm shadow-md transition-colors"
              >
                Create Account & Organization
              </button>
            </form>
          ) : (
            <form onSubmit={awaitingTwoFactor ? (event) => { event.preventDefault(); void handleTwoFactorLogin(); } : handleLogin} className="space-y-4">
              {awaitingTwoFactor ? (
                <>
                  <label htmlFor="two-factor-login" className="block text-xs font-semibold uppercase text-slate-300">Authenticator-Code</label>
                  <input id="two-factor-login" inputMode="numeric" autoComplete="one-time-code" value={twoFactorLoginCode} onChange={(event) => setTwoFactorLoginCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" required className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm" />
                  <button type="button" disabled={twoFactorLoginCode.length !== 6} onClick={() => void handleTwoFactorLogin()} className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Anmeldung bestätigen</button>
                  <button type="button" onClick={() => { setAwaitingTwoFactor(false); setTwoFactorLoginCode(""); }} className="w-full text-xs text-slate-400">Zurück zur Anmeldung</button>
                </>
              ) : (
                <>
              <div>
                <label
                  htmlFor="support-field-5"
                  className="block text-xs font-semibold text-slate-300 uppercase mb-1"
                >
                  Work Email
                </label>
                <input
                  id="support-field-5"
                  type="email"
                  required
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="admin@company.com"
                />
              </div>
              <div>
                <label
                  htmlFor="support-field-6"
                  className="block text-xs font-semibold text-slate-300 uppercase mb-1"
                >
                  Password
                </label>
                <input
                  id="support-field-6"
                  type="password"
                  required
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg text-sm shadow-md transition-colors"
              >
                Sign In to Dashboard
              </button>
                </>
              )}
            </form>
          )}

          <div className="mt-6 border-t border-slate-800 pt-4 text-center text-xs text-slate-400">
            Konten werden durch eine Organisationseinladung bereitgestellt.
          </div>
        </div>
      </div>
    );
  }

  // --- Main SaaS Dashboard Layout ---
  return (
    <div className={`relvona-workspace flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden ${activeTab === "overview" ? "relvona-workspace--overview" : ""}`}>
      {notification && (
        <div className="fixed top-4 right-4 z-50 bg-blue-600 text-white px-4 py-2.5 rounded-lg shadow-xl text-sm flex items-center gap-2 animate-bounce">
          <CheckCircle className="w-4 h-4" />
          <span>{notification}</span>
        </div>
      )}

      <aside className="rv-sidebar w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between shrink-0">
        <div>
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="rv-brand-mark w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shrink-0">R</div>
              <div className="truncate">
                <h2 className="text-sm font-bold truncate text-white">
                  Relvona
                </h2>
                <span className="text-[10px] bg-blue-950 text-blue-400 px-1.5 py-0.5 rounded font-mono border border-blue-800">
                  {activeOrg?.role || "member"}
                </span>
              </div>
            </div>
          </div>

          {!administration && auth.organizations.length > 1 && (
            <div className="px-3 py-2 border-b border-slate-800">
              <select
                className="w-full bg-slate-800 text-xs text-slate-200 border border-slate-700 rounded px-2 py-1 focus:outline-none"
                value={activeOrg?.id}
                onChange={(e) => {
                  const selected = auth.organizations.find(
                    (o) => o.id === e.target.value,
                  );
                  if (selected && selected.id !== activeOrg?.id) {
                    tenantFetchEpoch.current += 1;
                    ticketDetailRequestId.current += 1;
                    conversationDetailRequestId.current += 1;
                    suggestionRequestId.current += 1;
                    selectedConversationId.current = undefined;
                    setSuggesting(false);
                    setOverviewMetrics(null);
                    setConversationsList([]);
                    setSelectedConv(null);
                    setConvMessages([]);
                    setInboxSearch("");
                    setDebouncedInboxSearch("");
                    setInboxTags([]);
                    setInboxAgents([]);
                    setInboxTimeline([]);
                    setInboxHandoff(null);
                    setSuggestion(null);
                    setSelectedTicket(null);
                    setTicketCommentsList([]);
                    setTicketsList([]);
                    setKnowledgeBases([]);
                    setKnowledgeSources([]);
                    setSelectedKbId("");
                    setAssistantsList([]);
                    setActiveAssistant(null);
                    setAgentsList([]);
                    setCustomersList([]);
                    setTranslations({});
                    setPdfFile(null);
                    setDocTitle("");
                    setDocContent("");
                    setCrawlUrl("");
                    setActiveOrg(selected);
                    localStorage.setItem("active_org_id", selected.id);
                  }
                }}
              >
                {auth.organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <nav className="rv-main-nav p-3 space-y-1">
            {administration && (
              <a href="/admin" className="block p-3 text-sm text-blue-400">
                Plattformverwaltung
              </a>
            )}
            {!administration && auth.user.systemRole === "superadmin" && (
              <a href="/admin" className="block p-3 text-sm text-blue-400">
                Plattformverwaltung
              </a>
            )}
            {dashboardNavigation(administration)
              .map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-blue-600 text-white font-semibold"
                        : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            {!administration && auth.user.systemRole === "superadmin" && (
              <div className="rv-nav-secondary">
                <p>Workspace</p>
                <a href="/admin/scheduling"><CalendarDays size={16}/> Termine</a>
                <a href="/admin/support-automations"><Workflow size={16}/> AI-Automationen</a>
                <a href="/admin/employees"><Users size={16}/> Mitarbeiter</a>
                <a href="/admin/integrations"><Globe size={16}/> Integrationen</a>
              </div>
            )}
          </nav>
        </div>

        <div className="p-3 border-t border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="w-7 h-7 overflow-hidden rounded-full bg-slate-700 flex items-center justify-center font-bold text-xs">
              {auth.user.avatarUrl ? (
                <img
                  src={auth.user.avatarUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                auth.user.name.charAt(0)
              )}
            </div>
            <div className="truncate">
              <p className="text-xs font-medium text-slate-200 truncate">
                {auth.user.name}
              </p>
              <p className="text-[10px] text-slate-500 truncate">
                {auth.user.email}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            title="Abmelden"
            className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      <main className={activeTab === "overview" ? "rv-main rv-main--overview flex-1 overflow-y-auto" : ["analytics", "customers", "agents", "tickets", "conversations", "knowledge", "websites", "assistant", "widget", "settings"].includes(activeTab) ? "rv-main rv-main--modern flex-1 overflow-y-auto p-6" : "rv-main flex-1 bg-slate-950 overflow-y-auto p-6"}>
        {activeTab === "profile" && (
          <div className="mx-auto max-w-2xl space-y-6">
            <div>
              <h1 className="text-xl font-bold text-white">Profil-Einstellungen</h1>
              <p className="text-xs text-slate-400">
                Name, Profilbild, Sprache und dein persönliches Theme verwalten.
              </p>
            </div>
            <form
              onSubmit={handleSaveProfile}
              className="space-y-5 rounded-xl border border-slate-800 bg-slate-900 p-6"
            >
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 overflow-hidden rounded-full bg-slate-700 text-xl font-bold flex items-center justify-center">
                  {profileAvatarUrl ? (
                    <img
                      src={profileAvatarUrl}
                      alt="Profile preview"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    (profileName || auth.user.name).charAt(0)
                  )}
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="support-field-7"
                    className="block text-xs font-semibold text-slate-300"
                  >
                    Profile image
                  </label>
                  <input
                    id="support-field-7"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) =>
                      handleProfileImage(event.target.files?.[0])
                    }
                    className="block text-xs text-slate-400 file:mr-3 file:rounded file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-xs file:text-slate-100"
                  />
                  {profileAvatarUrl && (
                    <button
                      type="button"
                      onClick={() => setProfileAvatarUrl(null)}
                      className="text-xs text-red-300 hover:text-red-200"
                    >
                      Remove image
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label
                  htmlFor="support-field-8"
                  className="mb-1 block text-xs font-semibold text-slate-300"
                >
                  Name
                </label>
                <input
                  id="support-field-8"
                  required
                  minLength={2}
                  maxLength={100}
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label
                  htmlFor="support-field-9"
                  className="mb-1 block text-xs font-semibold text-slate-300"
                >
                  Preferred language
                </label>
                <select
                  id="support-field-9"
                  value={preferredLanguage}
                  onChange={(event) => setPreferredLanguage(event.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="de">Deutsch</option>
                  <option value="en">English</option>
                  <option value="es">Español</option>
                  <option value="fr">Français</option>
                </select>
              </div>
              <fieldset className="space-y-4 border-t border-slate-700 pt-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <legend className="text-sm font-semibold text-slate-100">Persönliches Erscheinungsbild</legend>
                    <p className="text-xs text-slate-400">Gilt nur für dein Benutzerkonto und wird sofort als Vorschau angezeigt.</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setThemePreferences(DEFAULT_USER_THEME)} className="rounded border border-slate-700 px-3 py-2 text-xs text-slate-200">Dunkel</button>
                    <button type="button" onClick={() => setThemePreferences(LIGHT_USER_THEME)} className="rounded border border-slate-700 px-3 py-2 text-xs text-slate-200">Hell</button>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {([
                    ["backgroundColor", "Hintergrund"],
                    ["surfaceColor", "Flächen"],
                    ["textColor", "Schrift"],
                    ["mutedTextColor", "Sekundärschrift"],
                    ["primaryColor", "Akzentfarbe"],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-300">
                      <span>{label}</span>
                      <span className="flex items-center gap-2">
                        <input type="color" aria-label={label} value={themePreferences[key]} onChange={(event) => setThemePreferences({ ...themePreferences, [key]: event.target.value })} className="h-10 w-12 rounded border border-slate-700 bg-slate-800 p-1" />
                        <code className="w-16 text-[10px] font-normal text-slate-400">{themePreferences[key]}</code>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-xs font-semibold text-slate-300">
                    Schriftart
                    <select value={themePreferences.fontFamily} onChange={(event) => setThemePreferences({ ...themePreferences, fontFamily: event.target.value as UserThemePreferences["fontFamily"] })} className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100">
                      <option value="sans">Sans Serif</option><option value="serif">Serif</option><option value="mono">Monospace</option>
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-slate-300">
                    Abstände
                    <select value={themePreferences.density} onChange={(event) => setThemePreferences({ ...themePreferences, density: event.target.value as UserThemePreferences["density"] })} className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100">
                      <option value="compact">Kompakt</option><option value="comfortable">Komfortabel</option><option value="spacious">Großzügig</option>
                    </select>
                  </label>
                  <label className="text-xs font-semibold text-slate-300">
                    Schriftgröße: {themePreferences.fontSize}px
                    <input type="range" min="12" max="20" step="1" value={themePreferences.fontSize} onChange={(event) => setThemePreferences({ ...themePreferences, fontSize: Number(event.target.value) })} className="mt-2 w-full" />
                  </label>
                  <label className="text-xs font-semibold text-slate-300">
                    Eckenradius: {themePreferences.radius}px
                    <input type="range" min="0" max="24" step="1" value={themePreferences.radius} onChange={(event) => setThemePreferences({ ...themePreferences, radius: Number(event.target.value) })} className="mt-2 w-full" />
                  </label>
                </div>
              </fieldset>
              <button
                type="submit"
                className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
              >
                Profil und Theme speichern
              </button>
            </form>
            <ProfileSecuritySettings
              user={auth.user}
              onUserChange={(user) => setAuth({ ...auth, user })}
            />
          </div>
        )}

        {activeTab === "overview" && (
          <LazyOverviewTab
            key={activeOrg?.id ?? "no-organization"}
            organizationId={activeOrg?.id}
            user={auth.user}
            canManage={auth.user.systemRole === "superadmin"}
            onNavigate={(tab) => setActiveTab(tab)}
            onOpenTicket={(ticket) => {
              const selectedOrganizationId = activeOrg?.id;
              if (!selectedOrganizationId) return;
              setActiveTab("tickets");
              void api.get("/tickets").then(({data}) => {
                if (activeOrgIdRef.current !== selectedOrganizationId) return;
                setTicketsList(data);
                const fullTicket = data.find((candidate: { id: string }) => candidate.id === ticket.id);
                if (fullTicket) void handleSelectTicket(fullTicket);
              }).catch(() => {
                if (activeOrgIdRef.current === selectedOrganizationId) {
                  showNotify("Ticketliste konnte nicht geladen werden.");
                }
              });
            }}
          />
        )}

        {activeTab === "analytics" && (
          <LazyAnalyticsTab
            overviewMetrics={overviewMetrics}
            onRefresh={() => void fetchTenantData()}
          />
        )}

        {activeTab === "agents" && <LazyAgentsTab agents={agentsList} />}

        {activeTab === "customers" && (
          <LazyCustomersTab customers={customersList} />
        )}

        {activeTab === "conversations" && (
          <ConversationsWorkspace
            key={activeOrg?.id ?? "no-organization"}
            currentUserId={auth?.user?.id}
            conversationsList={conversationsList}
            selectedConv={selectedConv}
            convMessages={convMessages}
            agentMsgInput={agentMsgInput}
            setAgentMsgInput={setAgentMsgInput}
            internalNoteInput={internalNoteInput}
            setInternalNoteInput={setInternalNoteInput}
            inboxState={inboxState}
            setInboxState={setInboxState}
            inboxPriority={inboxPriority}
            setInboxPriority={setInboxPriority}
            inboxAgentId={inboxAgentId}
            setInboxAgentId={setInboxAgentId}
            inboxFrom={inboxFrom}
            setInboxFrom={setInboxFrom}
            inboxTo={inboxTo}
            setInboxTo={setInboxTo}
            inboxSearch={inboxSearch}
            setInboxSearch={setInboxSearch}
            inboxSort={inboxSort}
            setInboxSort={setInboxSort}
            inboxTags={inboxTags}
            inboxAgents={inboxAgents}
            agentPresence={agentPresence}
            inboxTagId={inboxTagId}
            setInboxTagId={setInboxTagId}
            inboxTimeline={inboxTimeline}
            inboxHandoff={inboxHandoff}
            suggestion={suggestion}
            setSuggestion={setSuggestion}
            suggesting={suggesting}
            connected={connected}
            translations={translations}
            preferredLanguage={preferredLanguage}
            fetchTenantData={fetchTenantData}
            handleSelectConversation={handleSelectConversation}
            handleSendAgentMessage={handleSendAgentMessage}
            handleResolveConversation={handleResolveConversation}
            handleTranslateMessage={handleTranslateMessage}
            handlePresenceChange={handlePresenceChange}
            handleInboxAction={handleInboxAction}
            handleToggleConversationTag={handleToggleConversationTag}
            handleAddInternalNote={handleAddInternalNote}
            handleSuggestReply={handleSuggestReply}
          />
        )}

                {activeTab === "tickets" && (
          <TicketsWorkspace
            key={activeOrg?.id ?? "no-organization"}
            ticketsList={ticketsList}
            selectedTicket={selectedTicket}
            ticketCommentsList={ticketCommentsList}
            commentInput={commentInput}
            setCommentInput={setCommentInput}
            handleSelectTicket={handleSelectTicket}
            handleOpenTicketConversation={handleOpenTicketConversation}
            handleTicketStatusChange={handleTicketStatusChange}
            handleAddTicketComment={handleAddTicketComment}
          />
        )}

                {activeTab === "knowledge" && (
          <KnowledgeWorkspace
            organizationId={activeOrg?.id}
            canManage={["owner", "admin"].includes(activeOrg?.role)}
            knowledgeBases={knowledgeBases}
            knowledgeSources={knowledgeSources}
            selectedKbId={selectedKbId}
            setSelectedKbId={setSelectedKbId}
            fetchTenantData={fetchTenantData}
            showNotify={showNotify}
            loading={loading}
            newKbName={newKbName}
            setNewKbName={setNewKbName}
            handleCreateKnowledgeBase={handleCreateKnowledgeBase}
            handleAddTextDocument={handleAddTextDocument}
            handleUploadPdf={handleUploadPdf}
            docType={docType}
            setDocType={setDocType}
            docTitle={docTitle}
            setDocTitle={setDocTitle}
            docContent={docContent}
            setDocContent={setDocContent}
            docCategory={docCategory}
            setDocCategory={setDocCategory}
            docLanguage={docLanguage}
            setDocLanguage={setDocLanguage}
            pdfFile={pdfFile}
            setPdfFile={setPdfFile}
          />
        )}

                {activeTab === "websites" && (
          <WebsiteCrawlerWorkspace
            organizationId={activeOrg?.id}
            canManage={["owner", "admin"].includes(activeOrg?.role)}
            knowledgeBases={knowledgeBases}
            knowledgeSources={knowledgeSources}
            selectedKbId={selectedKbId}
            setSelectedKbId={setSelectedKbId}
            fetchTenantData={fetchTenantData}
            showNotify={showNotify}
            loading={loading}
            crawlUrl={crawlUrl}
            setCrawlUrl={setCrawlUrl}
            handleCreateCrawlerKnowledgeBase={handleCreateCrawlerKnowledgeBase}
            handleCrawlWebsite={handleCrawlWebsite}
          />
        )}

                {activeTab === "assistant" && !activeAssistant && (
          <div className="rv-assistant-workspace rv-config-workspace mx-auto max-w-4xl space-y-6">
            <WorkspaceHeader eyebrow="AI-KONFIGURATION" title="AI-Assistent"
              description="Verwalte deine AI-Assistenten und Modellprofile." />
            <div className="rv-config-card">
              <WorkspaceEmpty icon={Bot} title="Kein AI-Assistent verfügbar"
                description="Für diese Organisation ist noch keine Assistentenkonfiguration geladen." />
            </div>
          </div>
        )}

        {activeTab === "assistant" && activeAssistant && (
          <AssistantSettings
            key={activeAssistant.id}
            assistant={activeAssistant}
            onChange={setActiveAssistant}
            onSave={handleSaveAssistantSettings}
          />
        )}

                {activeTab === "widget" && activeOrg && activeAssistant && (
          <WidgetDesigner
            key={activeAssistant.id}
            assistant={activeAssistant}
            onChange={setActiveAssistant}
            onSave={handleSaveAssistantSettings}
            onRotateKey={() => { void handleRotateWidgetKey(); }}
          />
        )}

                {activeTab === "settings" && activeOrg && (
          <OrganizationSettings
            key={activeOrg.id}
            organizationId={activeOrg.id}
            apiKey={activeOrg.apiKey}
            onKeyRotated={(orgId, apiKey) => {
              setActiveOrg((current: any) =>
                current?.id === orgId ? { ...current, apiKey } : current,
              );
              setAuth((current) => current ? {
                ...current,
                organizations: current.organizations.map((org: any) =>
                  org.id === orgId ? { ...org, apiKey } : org,
                ),
              } : current);
            }}
            notify={showNotify}
          />
        )}
      </main>
    </div>
  );
}
