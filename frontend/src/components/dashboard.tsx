"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  Bot,
  Globe,
  MessageSquare,
  Ticket,
  BarChart3,
  Settings,
  Upload,
  UserCheck,
  Sparkles,
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  Users,
  LogOut,
  Sliders,
  BookOpen,
  CalendarDays,
  Workflow,
  Search,
} from "lucide-react";
import ProfileSecuritySettings from "@/components/profile-security-settings";
import OrganizationSettings from "@/components/dashboard-tabs/organization-settings";
import WidgetDesigner from "@/components/dashboard-tabs/widget-designer";
import { KnowledgeWorkspace, WebsiteCrawlerWorkspace } from "@/components/dashboard-tabs/knowledge-workspaces";
import { WorkspaceEmpty, WorkspaceHeader } from "@/components/dashboard-tabs/workspace-primitives";
import {
  LazyAgentsTab,
  LazyAnalyticsTab,
  LazyCustomersTab,
  LazyOverviewTab,
} from "@/components/dashboard-tabs/lazy-tabs";
import { api, API_BASE_URL } from "@/lib/api";
import { TICKET_STATUS_OPTIONS, ticketStatusLabel, ticketStatusTone } from "@/lib/support-status";
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
  selectedConversationId.current = selectedConv?.id;

  const [ticketsList, setTicketsList] = useState<any[]>([]);
  const [ticketSearch, setTicketSearch] = useState("");
  const [ticketStatus, setTicketStatus] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [ticketCommentsList, setTicketCommentsList] = useState<any[]>([]);
  const [commentInput, setCommentInput] = useState("");

  const [knowledgeBases, setKnowledgeBases] = useState<any[]>([]);
  const [knowledgeSources, setKnowledgeSources] = useState<any[]>([]);
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

  useEffect(() => {
    setSuggestion(null);
    if (
      !auth ||
      !activeOrg?.id ||
      !selectedConv?.id ||
      selectedConv.organizationId !== activeOrg.id
    )
      return;
    let active = true;
    const conversationId = selectedConv.id;
    const socket = io(new URL(API_BASE_URL, window.location.origin).origin, {
      withCredentials: true,
    });
    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join_room", {
        organizationId: activeOrg.id,
        conversationId,
      });
      void api
        .get(`/conversations/${conversationId}/messages`)
        .then((response) => {
          if (active)
            setConvMessages((current) => {
              const byId = new Map(
                response.data.map((message: any) => [message.id, message]),
              );
              for (const message of current)
                if (message.conversationId === conversationId)
                  byId.set(message.id, message);
              return [...byId.values()].sort(
                (a: any, b: any) =>
                  a.createdAt.localeCompare(b.createdAt) ||
                  a.id.localeCompare(b.id),
              );
            });
        })
        .catch(() => {
          if (active)
            setNotification("Nachrichten konnten nicht aktualisiert werden.");
        });
    });
    socket.on("new_message", (message) => {
      if (message.conversationId !== conversationId) return;
      setConvMessages((current) =>
        current.some((item) => item.id === message.id)
          ? current
          : [...current, message].sort(
              (a, b) =>
                a.createdAt.localeCompare(b.createdAt) ||
                a.id.localeCompare(b.id),
            ),
      );
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.on("error", () => setConnected(false));
    return () => {
      active = false;
      socket.disconnect();
      setConnected(false);
    };
  }, [auth, activeOrg?.id, selectedConv?.id, selectedConv?.organizationId]);

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
            q: inboxSearch || undefined,
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
    inboxSearch,
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

  const handleSelectConversation = async (conv: any) => {
    setSelectedConv(conv);
    setInboxHandoff(null);
    try {
      const [messages, timeline, handoff] = await Promise.all([
        api.get(`/conversations/${conv.id}/messages`),
        api.get(`/conversations/${conv.id}/timeline`),
        api.get(`/conversations/${conv.id}/handoff`).catch(() => null),
      ]);
      setConvMessages(messages.data);
      setInboxTimeline(timeline.data);
      setInboxHandoff(handoff?.data || null);
    } catch (err) {}
  };

  const handleInboxAction = async (path: string, body?: any) => {
    if (!selectedConv) return;
    try {
      const result = await api.put(
        `/conversations/${selectedConv.id}/${path}`,
        body,
      );
      if (result.data?.id)
        setSelectedConv((current: any) => ({ ...current, ...result.data }));
      await handleSelectConversation({
        ...selectedConv,
        ...(result.data || {}),
      });
      void fetchTenantData();
    } catch (err: any) {
      showNotify(
        err.response?.data?.error || "Aktion konnte nicht ausgeführt werden.",
      );
    }
  };

  const handleToggleConversationTag = async (tag: any) => {
    if (!selectedConv) return;
    const existing = selectedConv.tags || [];
    const nextTags = existing.some((item: any) => item.id === tag.id)
      ? existing.filter((item: any) => item.id !== tag.id)
      : [...existing, tag];
    try {
      await api.put(`/conversations/${selectedConv.id}/tags`, {
        tagIds: nextTags.map((item: any) => item.id),
      });
      setSelectedConv((current: any) => ({ ...current, tags: nextTags }));
      await handleSelectConversation({ ...selectedConv, tags: nextTags });
      void fetchTenantData();
    } catch (err: any) {
      showNotify(
        err.response?.data?.error || "Tags konnten nicht aktualisiert werden.",
      );
    }
  };

  const handlePresenceChange = async (status: string) => {
    try {
      await api.put("/conversations/meta/presence", { status });
      setAgentPresence(status);
      setPresenceLoaded(true);
      showNotify(`Presence: ${status}`);
    } catch (err: any) {
      showNotify(
        err.response?.data?.error || "Presence konnte nicht gespeichert werden.",
      );
    }
  };

  const handleAddInternalNote = async () => {
    if (!selectedConv || !internalNoteInput.trim()) return;
    try {
      const res = await api.post(
        `/conversations/${selectedConv.id}/internal-notes`,
        { content: internalNoteInput },
      );
      setConvMessages((current) => [...current, res.data]);
      setInternalNoteInput("");
      showNotify("Interne Notiz gespeichert.");
    } catch (err: any) {
      showNotify(
        err.response?.data?.error || "Notiz konnte nicht gespeichert werden.",
      );
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

  const handleTranslateMessage = async (message: any) => {
    if (!selectedConv || translations[message.id]) return;
    try {
      const res = await api.post(
        `/conversations/${selectedConv.id}/messages/${message.id}/translation`,
        { targetLanguage: preferredLanguage },
      );
      setTranslations((current) => ({
        ...current,
        [message.id]: res.data.translatedContent,
      }));
    } catch (err: any) {
      showNotify(err.response?.data?.error || "Translation failed");
    }
  };

  const handleSendAgentMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConv || !agentMsgInput) return;
    try {
      const res = await api.post(`/conversations/${selectedConv.id}/messages`, {
        content: agentMsgInput,
      });
      if (selectedConversationId.current === res.data.conversationId) {
        setConvMessages((current) =>
          current.some((message) => message.id === res.data.id)
            ? current
            : [...current, res.data],
        );
        setAgentMsgInput("");
      }
      showNotify("Response sent to customer");
    } catch (err: any) {
      showNotify(err.response?.data?.error || "Failed to send message");
    }
  };

  const handleResolveConversation = async (convId: string) => {
    try {
      await api.post(`/conversations/${convId}/resolve`);
      showNotify("Conversation resolved");
      void fetchTenantData();
    } catch (err) {}
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

  const handleSelectTicket = async (ticket: any) => {
    setSelectedTicket(ticket);
    setTicketCommentsList([]);
    try {
      const res = await api.get(`/tickets/${ticket.id}/comments`);
      setTicketCommentsList(res.data);
    } catch (err) {
      console.error("Failed to load ticket comments", err);
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
      showNotify("Diesem Ticket ist keine Unterhaltung zugeordnet");
      return;
    }
    try {
      const res = await api.get("/conversations");
      const conversation = res.data.find(
        (item: any) => item.id === selectedTicket.conversationId,
      );
      if (!conversation) {
        showNotify("Die zugehörige Unterhaltung ist nicht mehr verfügbar");
        return;
      }
      setConversationsList(res.data);
      setActiveTab("conversations");
      await handleSelectConversation(conversation);
    } catch (err: any) {
      showNotify(
        err.response?.data?.error || "Unterhaltung konnte nicht geladen werden",
      );
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

  const visibleTickets = ticketsList.filter((ticket) => {
    if (ticketStatus && ticket.status !== ticketStatus) return false;
    const search = ticketSearch.trim().toLocaleLowerCase("de-DE");
    if (!search) return true;
    return [ticket.subject, ticket.ticketNumber, ticket.customer?.name, ticket.customer?.email]
      .some((value) => String(value ?? "").toLocaleLowerCase("de-DE").includes(search));
  });

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
                    setOverviewMetrics(null);
                    setConversationsList([]);
                    setSelectedConv(null);
                    setConvMessages([]);
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

      <main className={activeTab === "overview" ? "rv-main rv-main--overview flex-1 overflow-y-auto" : ["analytics", "customers", "agents", "tickets", "conversations", "knowledge", "websites", "assistant", "settings"].includes(activeTab) ? "rv-main rv-main--modern flex-1 overflow-y-auto p-6" : "rv-main flex-1 bg-slate-950 overflow-y-auto p-6"}>
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
              setActiveTab("tickets");
              void api.get("/tickets").then(({data}) => {
                setTicketsList(data);
                const fullTicket = data.find((candidate: any) => candidate.id === ticket.id);
                if (fullTicket) void handleSelectTicket(fullTicket);
              }).catch(() => showNotify("Ticketliste konnte nicht geladen werden."));
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
          <div className="rv-inbox-layout h-full flex gap-4 max-w-7xl mx-auto">
            <div className="rv-inbox-list w-1/3 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
              <div className="p-3 border-b border-slate-800 space-y-2">
                <div className="font-semibold text-sm">Conversation-Inbox</div>
                <input
                  value={inboxSearch}
                  onChange={(event) => setInboxSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void fetchTenantData();
                  }}
                  placeholder="Kunde, E-Mail, ID oder Nachricht"
                  aria-label="Unterhaltungen durchsuchen"
                  className="w-full rounded bg-slate-800 px-2 py-1.5 text-xs"
                />
                <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
                  <span>Meine Presence</span>
                  <select
                    value={agentPresence}
                    onChange={(event) =>
                      void handlePresenceChange(event.target.value)
                    }
                    className="rounded bg-slate-800 p-1 text-[10px] text-slate-200"
                  >
                    <option>ONLINE</option>
                    <option>AWAY</option>
                    <option>OFFLINE</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <select
                    value={inboxState}
                    onChange={(event) => setInboxState(event.target.value)}
                    className="rounded bg-slate-800 p-1 text-[10px]"
                  >
                    <option value="">Alle Status</option>
                    {[
                      "AI_ACTIVE",
                      "NEEDS_HUMAN",
                      "WAITING_FOR_AGENT",
                      "AGENT_ACTIVE",
                      "WAITING_FOR_CUSTOMER",
                      "RESOLVED",
                      "CLOSED",
                    ].map((state) => (
                      <option key={state}>{state}</option>
                    ))}
                  </select>
                  <select
                    value={inboxAgentId}
                    onChange={(event) => setInboxAgentId(event.target.value)}
                    className="rounded bg-slate-800 p-1 text-[10px]"
                  >
                    <option value="">Alle Agenten</option>
                    <option value="unassigned">Nicht zugewiesen</option>
                    {inboxAgents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name || agent.email}
                      </option>
                    ))}
                  </select>
                  <select
                    value={inboxTagId}
                    onChange={(event) => setInboxTagId(event.target.value)}
                    className="rounded bg-slate-800 p-1 text-[10px]"
                  >
                    <option value="">Alle Tags</option>
                    {inboxTags.map((tag) => (
                      <option key={tag.id} value={tag.id}>
                        {tag.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={inboxFrom}
                    onChange={(event) => setInboxFrom(event.target.value)}
                    aria-label="Von Datum"
                    className="rounded bg-slate-800 p-1 text-[10px]"
                  />
                  <input
                    type="date"
                    value={inboxTo}
                    onChange={(event) => setInboxTo(event.target.value)}
                    aria-label="Bis Datum"
                    className="rounded bg-slate-800 p-1 text-[10px]"
                  />
                  <select
                    value={inboxPriority}
                    onChange={(event) => setInboxPriority(event.target.value)}
                    className="rounded bg-slate-800 p-1 text-[10px]"
                  >
                    <option value="">Alle Prioritäten</option>
                    {["LOW", "NORMAL", "HIGH", "URGENT"].map((priority) => (
                      <option key={priority}>{priority}</option>
                    ))}
                  </select>
                  <select
                    value={inboxSort}
                    onChange={(event) => setInboxSort(event.target.value)}
                    className="col-span-2 rounded bg-slate-800 p-1 text-[10px]"
                  >
                    <option value="newest">Neueste Aktivität</option>
                    <option value="oldest_waiting">
                      Älteste wartende Anfrage
                    </option>
                    <option value="priority">Höchste Priorität</option>
                    <option value="sla_risk">SLA-Risiko</option>
                  </select>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
                {conversationsList.length === 0 && (
                  <div className="rv-inbox-empty" role="status">
                    <MessageSquare size={24} aria-hidden="true" />
                    <strong>Keine Unterhaltungen gefunden</strong>
                    <p>Neue Anfragen und passende Suchergebnisse erscheinen hier.</p>
                  </div>
                )}
                {conversationsList.map((conv) => (
                  <button
                    type="button"
                    key={conv.id}
                    onClick={() => handleSelectConversation(conv)}
                    aria-current={selectedConv?.id === conv.id ? "true" : undefined}
                    className={`w-full p-3 text-left transition-colors flex flex-col gap-1 ${
                      selectedConv?.id === conv.id
                        ? "bg-blue-950/60 border-l-4 border-blue-500"
                        : "hover:bg-slate-800/40"
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold text-slate-200">
                        {conv.customer?.name || "Visitor"}
                      </span>
                      <span
                        className={`text-[10px] font-semibold ${
                          conv.priority === "URGENT"
                            ? "text-red-400"
                            : conv.priority === "HIGH"
                              ? "text-amber-400"
                              : "text-slate-400"
                        }`}
                      >
                        {conv.priority || "NORMAL"}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                          conv.state === "WAITING_FOR_AGENT"
                            ? "bg-amber-950 text-amber-400 border border-amber-800"
                            : conv.state === "RESOLVED"
                              ? "bg-emerald-950 text-emerald-400 border border-emerald-800"
                              : "bg-blue-950 text-blue-400 border border-blue-800"
                        }`}
                      >
                        {conv.state}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[10px] text-slate-500 mt-1">
                      <span>Lang: {conv.detectedLanguage}</span>
                      {conv.sentiment && (
                        <span
                          className={`capitalize font-bold ${
                            conv.sentiment === "frustrated"
                              ? "text-red-400 font-extrabold animate-pulse"
                              : conv.sentiment === "negative"
                                ? "text-amber-400"
                                : conv.sentiment === "positive"
                                  ? "text-emerald-400"
                                  : "text-slate-400"
                          }`}
                        >
                          ● {conv.sentiment}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rv-inbox-detail w-2/3 bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
              {selectedConv ? (
                <>
                  <div className="p-3 border-b border-slate-800 flex justify-between items-center bg-slate-900">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-200">
                        {selectedConv.customer?.name}
                      </h3>
                      <p className="text-[10px] text-slate-400">
                        {selectedConv.customer?.email}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <select
                        value={selectedConv.priority || "NORMAL"}
                        onChange={(event) =>
                          void handleInboxAction("priority", {
                            priority: event.target.value,
                          })
                        }
                        className="rounded bg-slate-800 px-2 text-[10px]"
                      >
                        {["LOW", "NORMAL", "HIGH", "URGENT"].map(
                          (priority) => (
                            <option key={priority}>{priority}</option>
                          ),
                        )}
                      </select>
                      <select
                        value={selectedConv.assignedAgentId || ""}
                        onChange={(event) =>
                          void handleInboxAction("assignment", {
                            agentId: event.target.value || null,
                          })
                        }
                        className="max-w-32 rounded bg-slate-800 px-2 text-[10px]"
                      >
                        <option value="">Unassign</option>
                        {inboxAgents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name || agent.email}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          void handleInboxAction("assignment", {
                            agentId: auth?.user?.id,
                          })
                        }
                        className="rounded bg-violet-700 px-2 py-1 text-xs"
                      >
                        Assign to me
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleResolveConversation(selectedConv.id)
                        }
                        className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded"
                      >
                        Mark Resolved
                      </button>
                    </div>
                  </div>

                  {inboxTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 border-b border-slate-800 bg-slate-900 px-3 py-2">
                      {inboxTags.map((tag) => {
                        const active = (selectedConv.tags || []).some(
                          (item: any) => item.id === tag.id,
                        );
                        return (
                          <button
                            type="button"
                            key={tag.id}
                            onClick={() => void handleToggleConversationTag(tag)}
                            className={`rounded px-2 py-1 text-[10px] ${
                              active
                                ? "bg-blue-700 text-white"
                                : "bg-slate-800 text-slate-400 hover:text-white"
                            }`}
                          >
                            {active ? "✓ " : "+ "}
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-950/40">
                    {inboxHandoff && (
                      <section className="rounded-lg border border-amber-800/80 bg-amber-950/35 p-3 text-xs text-amber-100">
                        <div className="flex items-center justify-between gap-2">
                          <strong>Human Handoff</strong>
                          <span className="rounded bg-amber-900/70 px-1.5 py-0.5 font-mono text-[10px]">
                            {inboxHandoff.requestedPriority}
                          </span>
                        </div>
                        <p className="mt-1">Grund: {inboxHandoff.reason}</p>
                        {inboxHandoff.aiConfidence !== null && (
                          <p className="mt-1">
                            AI Confidence:{" "}
                            {Math.round(Number(inboxHandoff.aiConfidence) * 100)}%
                          </p>
                        )}
                        {inboxHandoff.lastAiAttempt && (
                          <p className="mt-2 rounded bg-slate-950/50 p-2 text-slate-300">
                            Letzter AI-Versuch: {inboxHandoff.lastAiAttempt}
                          </p>
                        )}
                        <p className="mt-2 text-[10px] text-amber-300">
                          {inboxHandoff.claimedAt
                            ? `Übernommen am ${new Date(inboxHandoff.claimedAt).toLocaleString()}`
                            : `Eskaliert am ${new Date(inboxHandoff.createdAt).toLocaleString()}`}
                        </p>
                      </section>
                    )}
                    {inboxTimeline.length > 0 && (
                      <section className="rounded-lg border border-slate-800 bg-slate-900/70 p-3 text-xs">
                        <h4 className="font-semibold text-slate-200">
                          Activity Timeline
                        </h4>
                        <ol className="mt-2 space-y-2 border-l border-slate-700 pl-3">
                          {inboxTimeline.slice(-8).map((event) => {
                            const labels: Record<string, string> = {
                              handoff_requested: "Human handoff requested",
                              assignment_changed: "Assignment changed",
                              unassigned: "Conversation unassigned",
                              priority_changed: "Priority changed",
                              tags_changed: "Tags updated",
                              internal_note_added: "Internal note added",
                              status_changed: "Status changed",
                              auto_closed: "Automatically closed",
                            };
                            return (
                              <li
                                key={event.id}
                                className="relative text-slate-400 before:absolute before:-left-[17px] before:top-1.5 before:size-1.5 before:rounded-full before:bg-blue-400"
                              >
                                <span className="text-slate-200">
                                  {labels[event.eventType] || event.eventType}
                                </span>
                                {event.payload?.to && (
                                  <span className="ml-1 text-slate-500">
                                    → {event.payload.to}
                                  </span>
                                )}
                                <time className="ml-2 text-[10px] text-slate-500">
                                  {new Date(event.createdAt).toLocaleString()}
                                </time>
                              </li>
                            );
                          })}
                        </ol>
                      </section>
                    )}
                    {convMessages.map((m) => (
                      <div
                        key={m.id}
                        className={`max-w-md p-3 rounded-xl text-xs ${
                          m.senderType === "internal_note"
                            ? "bg-amber-950/60 text-amber-100 mr-auto rounded border border-amber-800"
                            : m.senderType === "customer"
                              ? "bg-blue-600 text-white ml-auto rounded-br-none"
                              : m.senderType === "agent"
                                ? "bg-purple-700 text-white ml-auto rounded-br-none"
                                : "bg-slate-800 text-slate-200 mr-auto rounded-bl-none border border-slate-700"
                        }`}
                      >
                        <div className="font-semibold text-[10px] opacity-75 mb-1">
                          {m.senderName || m.senderType}
                        </div>
                        <p className="leading-relaxed">{m.content}</p>
                        {m.senderType === "customer" && (
                          <div className="mt-2 border-t border-white/15 pt-2">
                            {translations[m.id] ? (
                              <p className="leading-relaxed text-white/80">
                                <span className="mr-1 text-[10px] font-semibold uppercase opacity-70">
                                  {preferredLanguage}
                                </span>
                                {translations[m.id]}
                              </p>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleTranslateMessage(m)}
                                className="text-[10px] font-medium text-blue-200 hover:text-white"
                              >
                                Übersetzen ({preferredLanguage.toUpperCase()})
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="p-3 border-t border-slate-800 text-xs space-y-2">
                    <span>
                      {connected
                        ? "Live verbunden"
                        : "Live-Verbindung unterbrochen"}
                    </span>
                    <button
                      type="button"
                      disabled={suggesting}
                      className="ml-3 text-blue-300 disabled:opacity-50"
                      onClick={async () => {
                        setSuggesting(true);
                        try {
                          const response = await api.post(
                            `/conversations/${selectedConv.id}/suggested-reply`,
                          );
                          setSuggestion({
                            ...response.data,
                            conversationId: selectedConv.id,
                          });
                        } catch {
                          showNotify(
                            "Antwortvorschlag konnte nicht erstellt werden.",
                          );
                        } finally {
                          setSuggesting(false);
                        }
                      }}
                    >
                      {suggesting
                        ? "Vorschlag wird erstellt …"
                        : "Antwortvorschlag erstellen"}
                    </button>
                    {suggestion?.conversationId === selectedConv.id &&
                      suggestion && (
                        <div className="rounded bg-slate-800 p-3 space-y-2">
                          <p>{suggestion.content}</p>
                          <p>{suggestion.sources.join(" · ")}</p>
                          <button
                            type="button"
                            className="mr-3 text-blue-300"
                            onClick={() => {
                              setAgentMsgInput(suggestion.content);
                              setSuggestion(null);
                            }}
                          >
                            Übernehmen und bearbeiten
                          </button>
                          <button
                            type="button"
                            onClick={() => setSuggestion(null)}
                          >
                            Verwerfen
                          </button>
                        </div>
                      )}
                  </div>
                  <div className="border-t border-amber-900/70 bg-amber-950/20 p-3">
                    <p className="mb-2 text-[10px] font-semibold uppercase text-amber-300">
                      Interne Notiz — wird niemals an den Kunden gesendet
                    </p>
                    <div className="flex gap-2">
                      <input
                        value={internalNoteInput}
                        onChange={(event) =>
                          setInternalNoteInput(event.target.value)
                        }
                        className="flex-1 rounded border border-amber-800 bg-slate-900 px-3 py-2 text-xs"
                        placeholder="Notiz für das Support-Team"
                      />
                      <button
                        type="button"
                        onClick={handleAddInternalNote}
                        className="rounded bg-amber-700 px-3 text-xs font-semibold"
                      >
                        Notiz speichern
                      </button>
                    </div>
                  </div>
                  <form
                    onSubmit={handleSendAgentMessage}
                    className="p-3 border-t border-slate-800 bg-slate-900 flex gap-2"
                  >
                    <input
                      type="text"
                      className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                      placeholder="Type agent response..."
                      value={agentMsgInput}
                      onChange={(e) => setAgentMsgInput(e.target.value)}
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded"
                    >
                      Send Reply
                    </button>
                  </form>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-slate-500 text-xs">
                  Wähle links eine Unterhaltung aus, um sie zu bearbeiten.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "tickets" && (
          <div className="rv-ticket-workspace space-y-4 max-w-7xl mx-auto">
            <div>
              <h1 className="text-xl font-bold text-white">
                Support-Tickets
              </h1>
              <p className="mt-1 text-xs text-slate-400">
                KI-Eskalationen werden automatisch als offene Tickets in diese
                Warteschlange übernommen.
              </p>
            </div>

            <div className="rv-ticket-filters">
              <label className="rv-section-search">
                <Search className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Tickets suchen</span>
                <input type="search" value={ticketSearch}
                  onChange={(event) => setTicketSearch(event.target.value)}
                  placeholder="Betreff, Ticketnummer oder Kunden suchen" />
              </label>
              <label className="rv-ticket-filter-status">
                <span className="sr-only">Nach Ticketstatus filtern</span>
                <select value={ticketStatus} onChange={(event) => setTicketStatus(event.target.value)}>
                  <option value="">Alle Status</option>
                  {TICKET_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <span className="rv-directory-result">{visibleTickets.length} Tickets</span>
            </div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="rv-ticket-table bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-800/80 text-slate-400 uppercase text-[10px] font-semibold">
                    <tr>
                      <th className="p-3"># Ticket</th>
                      <th className="p-3">Subject</th>
                      <th className="p-3">Customer</th>
                      <th className="p-3">Priority</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {visibleTickets.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          className="p-8 text-center text-slate-500"
                        >
                          {ticketsList.length === 0
                            ? "Noch keine Tickets vorhanden."
                            : "Keine Tickets entsprechen den gewählten Filtern."}
                        </td>
                      </tr>
                    )}
                    {visibleTickets.map((tk) => (
                      <tr
                        key={tk.id}
                        className={`hover:bg-slate-800/40 ${
                          selectedTicket?.id === tk.id ? "bg-blue-950/20" : ""
                        }`}
                      >
                        <td className="p-3 font-mono font-bold text-blue-400">
                          #{tk.ticketNumber}
                        </td>
                        <td className="p-3 font-medium text-slate-200">
                          <button
                            type="button"
                            onClick={() => handleSelectTicket(tk)}
                            aria-current={selectedTicket?.id === tk.id ? "true" : undefined}
                            className="rv-ticket-open text-left font-semibold"
                          >
                            {tk.subject}
                          </button>
                          {Array.isArray(tk.tags) &&
                            tk.tags.includes("ai-escalation") && (
                              <span className="mt-1 inline-block rounded border border-violet-800 bg-violet-950/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-violet-300">
                                KI-Eskalation
                              </span>
                            )}
                        </td>
                        <td className="p-3">
                          {tk.customer?.name || "Visitor"}
                        </td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                              tk.priority === "urgent"
                                ? "bg-red-950 text-red-400 border border-red-800"
                                : tk.priority === "high"
                                  ? "bg-amber-950 text-amber-400 border border-amber-800"
                                  : "bg-slate-800 text-slate-300"
                            }`}
                          >
                            {tk.priority}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className={`rv-ticket-status-pill rv-ticket-status-pill--${ticketStatusTone(tk.status)} px-2 py-0.5 rounded text-[10px] border uppercase font-semibold`}>
                            {ticketStatusLabel(tk.status)}
                          </span>
                        </td>
                        <td className="p-3 text-slate-500">
                          {new Date(tk.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <aside className="rv-ticket-details rounded-xl border border-slate-800 bg-slate-900 p-4">
                {selectedTicket ? (
                  <div className="space-y-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-blue-400">
                        Ticket #{selectedTicket.ticketNumber}
                      </p>
                      <h2 className="mt-1 text-sm font-semibold text-white">
                        {selectedTicket.subject}
                      </h2>
                    </div>
                    <p className="whitespace-pre-wrap text-xs leading-5 text-slate-300">
                      {selectedTicket.description ||
                        "Keine zusätzliche Beschreibung."}
                    </p>
                    {selectedTicket.githubIssueUrl && (
                      <a
                        href={selectedTicket.githubIssueUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex text-xs font-medium text-blue-400 hover:text-blue-300"
                      >
                        GitHub Issue #{selectedTicket.githubIssueNumber} öffnen
                      </a>
                    )}
                    {selectedTicket.githubIssueError && (
                      <p className="rounded border border-amber-800 bg-amber-950/30 p-2 text-xs text-amber-200">
                        GitHub-Synchronisierung fehlgeschlagen:{" "}
                        {selectedTicket.githubIssueError}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {selectedTicket.conversationId && (
                        <button
                          type="button"
                          onClick={handleOpenTicketConversation}
                          className="rounded border border-violet-800 bg-violet-950/50 px-2.5 py-1.5 text-[11px] font-semibold text-violet-300 hover:bg-violet-950"
                        >
                          Unterhaltung öffnen
                        </button>
                      )}
                      {selectedTicket.status !== "in_progress" && (
                        <button
                          type="button"
                          onClick={() =>
                            handleTicketStatusChange("in_progress")
                          }
                          className="rounded bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500"
                        >
                          Bearbeiten
                        </button>
                      )}
                      {selectedTicket.status !== "resolved" && (
                        <button
                          type="button"
                          onClick={() => handleTicketStatusChange("resolved")}
                          className="rounded border border-emerald-800 bg-emerald-950/50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-950"
                        >
                          Lösen
                        </button>
                      )}
                    </div>
                    <div className="border-t border-slate-800 pt-3">
                      <p className="mb-2 text-[10px] font-semibold uppercase text-slate-500">
                        Interne Kommentare
                      </p>
                      {ticketCommentsList.length ? (
                        ticketCommentsList.map((comment) => (
                          <div
                            key={comment.id}
                            className="mb-2 rounded bg-slate-800/70 p-2 text-[11px] text-slate-300"
                          >
                            <p>{comment.content}</p>
                            <p className="mt-1 text-[10px] text-slate-500">
                              {comment.author?.name || "Support"}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p className="mb-2 text-xs text-slate-500">
                          Noch keine Kommentare.
                        </p>
                      )}
                      <form
                        onSubmit={handleAddTicketComment}
                        className="mt-3 flex gap-2"
                      >
                        <input
                          value={commentInput}
                          onChange={(event) =>
                            setCommentInput(event.target.value)
                          }
                          maxLength={2000}
                          placeholder="Interne Notiz hinzufügen…"
                          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-[11px] text-slate-100 outline-none focus:border-blue-500"
                        />
                        <button
                          type="submit"
                          className="rounded bg-slate-700 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-600"
                        >
                          Notiz
                        </button>
                      </form>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs leading-5 text-slate-500">
                    Wähle ein Ticket, um Anfrage, Status und interne Kommentare
                    zu sehen.
                  </p>
                )}
              </aside>
            </div>
          </div>
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
          <div className="rv-assistant-workspace rv-config-workspace space-y-6 max-w-4xl mx-auto">
            <WorkspaceHeader eyebrow="AI-KONFIGURATION" title="AI-Assistent"
              description="Verwalte Modellanbieter, aktive Profile, API-Schlüssel und Systemanweisungen." />

            <div className="rounded-xl border border-blue-800/70 bg-blue-950/30 p-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-300">
                  Aktiv für neue Antworten
                </p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {(activeAssistant.modelProfiles || []).find(
                    (profile: any) =>
                      profile.id === activeAssistant.activeModelProfileId,
                  )?.label || "Standard-Konfiguration"}
                </p>
                <p className="text-xs text-slate-400">
                  {(activeAssistant.modelProfiles || []).find(
                    (profile: any) =>
                      profile.id === activeAssistant.activeModelProfileId,
                  )?.provider || activeAssistant.modelProvider}{" "}
                  ·{" "}
                  {(activeAssistant.modelProfiles || []).find(
                    (profile: any) =>
                      profile.id === activeAssistant.activeModelProfileId,
                  )?.modelName || activeAssistant.modelName}
                </p>
              </div>
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
                Live
              </span>
            </div>

            <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    Modell- & Provider-Konfigurationen
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    API-Schlüssel werden verschlüsselt gespeichert und nach dem
                    Speichern nicht erneut angezeigt.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={(activeAssistant.modelProfiles || []).length >= 8}
                  onClick={() => {
                    const id = `model_${Date.now().toString(36)}`;
                    setActiveAssistant({
                      ...activeAssistant,
                      modelProfiles: [
                        ...(activeAssistant.modelProfiles || []),
                        {
                          id,
                          label: "Neue Konfiguration",
                          provider: "openai",
                          modelName: "gpt-4o-mini",
                          baseUrl: "",
                          apiKey: "",
                        },
                      ],
                    });
                  }}
                  className="shrink-0 rounded bg-slate-700 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-600 disabled:opacity-50"
                >
                  <Plus className="mr-1 inline h-3.5 w-3.5" /> Hinzufügen
                </button>
              </div>
              {(activeAssistant.modelProfiles || []).length === 0 && (
                <div className="rounded-lg border border-dashed border-slate-700 p-4 text-xs text-slate-400">
                  Zurzeit wird die Standard-Konfiguration unten verwendet. Füge
                  eine Konfiguration hinzu, um etwa OpenAI, Claude, Gemini oder
                  ein lokales Modell hinterlegen zu können.
                </div>
              )}
              {(activeAssistant.modelProfiles || []).map(
                (profile: any, index: number) => (
                  <div
                    key={profile.id}
                    className={`rounded-lg border p-4 ${
                      activeAssistant.activeModelProfileId === profile.id
                        ? "border-blue-600 bg-blue-950/20"
                        : "border-slate-700 bg-slate-800/50"
                    }`}
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                        <input
                          type="radio"
                          name="active-model-profile"
                          checked={
                            activeAssistant.activeModelProfileId === profile.id
                          }
                          onChange={() =>
                            setActiveAssistant({
                              ...activeAssistant,
                              activeModelProfileId: profile.id,
                            })
                          }
                        />{" "}
                        Diese Konfiguration aktiv verwenden
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const modelProfiles = (
                            activeAssistant.modelProfiles || []
                          ).filter((item: any) => item.id !== profile.id);
                          setActiveAssistant({
                            ...activeAssistant,
                            modelProfiles,
                            activeModelProfileId:
                              activeAssistant.activeModelProfileId ===
                              profile.id
                                ? null
                                : activeAssistant.activeModelProfileId,
                          });
                        }}
                        className="text-slate-500 hover:text-red-300"
                        title="Konfiguration entfernen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label>
                        <span className="mb-1 block text-[11px] font-medium text-slate-400">
                          Name der Konfiguration
                        </span>
                        <input
                          value={profile.label || ""}
                          maxLength={60}
                          onChange={(e) =>
                            setActiveAssistant({
                              ...activeAssistant,
                              modelProfiles: (
                                activeAssistant.modelProfiles || []
                              ).map((item: any) =>
                                item.id === profile.id
                                  ? { ...item, label: e.target.value }
                                  : item,
                              ),
                            })
                          }
                          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100"
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-[11px] font-medium text-slate-400">
                          Provider
                        </span>
                        <select
                          value={profile.provider}
                          onChange={(e) =>
                            setActiveAssistant({
                              ...activeAssistant,
                              modelProfiles: (
                                activeAssistant.modelProfiles || []
                              ).map((item: any) =>
                                item.id === profile.id
                                  ? { ...item, provider: e.target.value }
                                  : item,
                              ),
                            })
                          }
                          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100"
                        >
                          <option value="openai">OpenAI</option>
                          <option value="anthropic">Anthropic</option>
                          <option value="google">Google Gemini</option>
                          <option value="nvidia">NVIDIA NIM</option>
                          <option value="local">
                            Local / Ollama / LocalAI
                          </option>
                        </select>
                      </label>
                      <label>
                        <span className="mb-1 block text-[11px] font-medium text-slate-400">
                          Modell
                        </span>
                        <input
                          value={profile.modelName || ""}
                          maxLength={160}
                          placeholder="z. B. gpt-4o-mini"
                          onChange={(e) =>
                            setActiveAssistant({
                              ...activeAssistant,
                              modelProfiles: (
                                activeAssistant.modelProfiles || []
                              ).map((item: any) =>
                                item.id === profile.id
                                  ? { ...item, modelName: e.target.value }
                                  : item,
                              ),
                            })
                          }
                          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100"
                        />
                      </label>
                      <label>
                        <span className="mb-1 block text-[11px] font-medium text-slate-400">
                          API-Schlüssel{" "}
                          {profile.apiKeyConfigured ? "(gespeichert)" : ""}
                        </span>
                        <input
                          type="password"
                          value={profile.apiKey || ""}
                          placeholder={
                            profile.apiKeyConfigured
                              ? "Unverändert lassen"
                              : "API-Schlüssel eingeben"
                          }
                          onChange={(e) =>
                            setActiveAssistant({
                              ...activeAssistant,
                              modelProfiles: (
                                activeAssistant.modelProfiles || []
                              ).map((item: any) =>
                                item.id === profile.id
                                  ? { ...item, apiKey: e.target.value }
                                  : item,
                              ),
                            })
                          }
                          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100"
                        />
                      </label>
                      {profile.provider === "local" && (
                        <label className="md:col-span-2">
                          <span className="mb-1 block text-[11px] font-medium text-slate-400">
                            Lokale Base URL
                          </span>
                          <input
                            value={profile.baseUrl || ""}
                            placeholder="http://localhost:11434/v1"
                            onChange={(e) =>
                              setActiveAssistant({
                                ...activeAssistant,
                                modelProfiles: (
                                  activeAssistant.modelProfiles || []
                                ).map((item: any) =>
                                  item.id === profile.id
                                    ? { ...item, baseUrl: e.target.value }
                                    : item,
                                ),
                              })
                            }
                            className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100"
                          />
                        </label>
                      )}
                    </div>
                    <p className="mt-3 text-[10px] text-slate-500">
                      Konfiguration {index + 1} · Änderungen mit „Save Universal
                      AI Gateway Settings“ speichern.
                    </p>
                  </div>
                ),
              )}
            </div>

            <form
              onSubmit={handleSaveAssistantSettings}
              className="bg-slate-900 border border-slate-800 p-6 rounded-xl space-y-5"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="support-field-15"
                    className="block text-xs font-semibold text-slate-300 uppercase mb-1"
                  >
                    Assistant Name
                  </label>
                  <input
                    id="support-field-15"
                    type="text"
                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none"
                    value={activeAssistant.name || ""}
                    onChange={(e) =>
                      setActiveAssistant({
                        ...activeAssistant,
                        name: e.target.value,
                      })
                    }
                  />
                </div>

                <div>
                  <label
                    htmlFor="support-field-16"
                    className="block text-xs font-semibold text-slate-300 uppercase mb-1"
                  >
                    AI Provider Gateway
                  </label>
                  <select
                    id="support-field-16"
                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none font-semibold text-blue-400"
                    value={activeAssistant.modelProvider || "openai"}
                    onChange={(e) =>
                      setActiveAssistant({
                        ...activeAssistant,
                        modelProvider: e.target.value,
                      })
                    }
                  >
                    <option value="openai">
                      OpenAI (GPT-4o / GPT-4o-mini)
                    </option>
                    <option value="anthropic">
                      Anthropic (Claude 3.5 Sonnet / Haiku / Opus)
                    </option>
                    <option value="google">
                      Google Gemini (Gemini 1.5 Flash / Pro / 2.0)
                    </option>
                    <option value="nvidia">
                      NVIDIA NIM (Llama 3.1 8B / 70B)
                    </option>
                    <option value="local">
                      Local / Ollama / LocalAI (OpenAI-compatible)
                    </option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="support-field-17"
                    className="block text-xs font-semibold text-slate-300 uppercase mb-1"
                  >
                    Model Name
                  </label>
                  <input
                    id="support-field-17"
                    type="text"
                    placeholder={
                      activeAssistant.modelProvider === "anthropic"
                        ? "claude-3-5-sonnet-20241022"
                        : activeAssistant.modelProvider === "google"
                          ? "gemini-1.5-flash"
                          : activeAssistant.modelProvider === "nvidia"
                            ? "nvidia/llama-3.1-8b-instruct"
                            : activeAssistant.modelProvider === "local"
                              ? "llama3"
                              : "gpt-4o-mini"
                    }
                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none font-mono text-slate-200"
                    value={activeAssistant.modelName || ""}
                    onChange={(e) =>
                      setActiveAssistant({
                        ...activeAssistant,
                        modelName: e.target.value,
                      })
                    }
                  />
                </div>

                <div>
                  <label
                    htmlFor="support-field-18"
                    className="block text-xs font-semibold text-slate-300 uppercase mb-1"
                  >
                    Custom API Key (Optional Override)
                  </label>
                  <input
                    id="support-field-18"
                    type="password"
                    placeholder="sk-..."
                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none font-mono text-slate-200"
                    value={activeAssistant.apiKey || ""}
                    onChange={(e) =>
                      setActiveAssistant({
                        ...activeAssistant,
                        apiKey: e.target.value,
                      })
                    }
                  />
                </div>
              </div>

              {activeAssistant.modelProvider === "local" && (
                <div>
                  <label
                    htmlFor="support-field-19"
                    className="block text-xs font-semibold text-slate-300 uppercase mb-1"
                  >
                    Custom Endpoint Base URL (Local/Ollama/LocalAI)
                  </label>
                  <input
                    id="support-field-19"
                    type="text"
                    placeholder="http://localhost:11434/v1"
                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none font-mono text-amber-400"
                    value={activeAssistant.baseUrl || ""}
                    onChange={(e) =>
                      setActiveAssistant({
                        ...activeAssistant,
                        baseUrl: e.target.value,
                      })
                    }
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Specify your custom Ollama or LocalAI OpenAI-compatible API
                    base URL.
                  </p>
                </div>
              )}

              <div>
                <label
                  htmlFor="support-field-20"
                  className="block text-xs font-semibold text-slate-300 uppercase mb-1"
                >
                  Temperature ({activeAssistant.temperature})
                </label>
                <input
                  id="support-field-20"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  className="w-full"
                  value={activeAssistant.temperature ?? 0.2}
                  onChange={(e) =>
                    setActiveAssistant({
                      ...activeAssistant,
                      temperature: parseFloat(e.target.value),
                    })
                  }
                />
              </div>

              <div>
                <label
                  htmlFor="support-field-21"
                  className="block text-xs font-semibold text-slate-300 uppercase mb-1"
                >
                  System Prompt Guardrails
                </label>
                <textarea
                  id="support-field-21"
                  rows={4}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none"
                  value={activeAssistant.systemPrompt || ""}
                  onChange={(e) =>
                    setActiveAssistant({
                      ...activeAssistant,
                      systemPrompt: e.target.value,
                    })
                  }
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded text-xs"
              >
                Save Universal AI Gateway Settings
              </button>
            </form>
          </div>
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
