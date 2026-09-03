"use client";

import { useEffect, useState } from "react";
import {
  Bot,
  FileText,
  Globe,
  HelpCircle,
  MessageSquare,
  Ticket,
  BarChart3,
  Settings,
  Upload,
  Send,
  UserCheck,
  Sparkles,
  Plus,
  Trash2,
  ExternalLink,
  CheckCircle,
  Clock,
  AlertCircle,
  Users,
  Code,
  Key,
  LogOut,
  RefreshCw,
  Search,
  Sliders,
  ChevronRight,
  Shield,
  BookOpen
} from "lucide-react";
import { api, API_BASE_URL } from "@/lib/api";
import { DashboardLanguage, localizeDashboard } from "@/lib/dashboard-i18n";

const DEFAULT_WIDGET_SETTINGS = {
  primaryColor: "#3B82F6",
  backgroundColor: "#F8FAFC",
  surfaceColor: "#FFFFFF",
  agentBubbleColor: "#E2E8F0",
  textColor: "#0F172A",
  borderRadius: 16,
  launcherRadius: 30,
  launcherSize: 60,
  windowWidth: 380,
  offset: 24,
  position: "bottom-right",
  fontFamily: "sans",
  launcherIcon: "💬",
  headerTitle: "",
  inputPlaceholder: "Wie können wir helfen?",
  sendLabel: "Senden",
};

export default function DashboardPage() {
  const [auth, setAuth] = useState<{ user: any; organizations: any[]; token: string } | null>(null);
  const [activeOrg, setActiveOrg] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<
    "overview" | "conversations" | "tickets" | "knowledge" | "websites" | "assistant" | "agents" | "customers" | "analytics" | "widget" | "settings" | "profile"
  >("overview");

  // Auth Form State
  const [isRegistering, setIsRegistering] = useState(false);
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authOrgName, setAuthOrgName] = useState("");
  const [authError, setAuthError] = useState("");

  // Data States
  const [overviewMetrics, setOverviewMetrics] = useState<any>(null);
  const [conversationsList, setConversationsList] = useState<any[]>([]);
  const [selectedConv, setSelectedConv] = useState<any>(null);
  const [convMessages, setConvMessages] = useState<any[]>([]);
  const [agentMsgInput, setAgentMsgInput] = useState("");

  const [ticketsList, setTicketsList] = useState<any[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [ticketCommentsList, setTicketCommentsList] = useState<any[]>([]);
  const [commentInput, setCommentInput] = useState("");

  const [knowledgeBases, setKnowledgeBases] = useState<any[]>([]);
  const [knowledgeSources, setKnowledgeSources] = useState<any[]>([]);
  const [websitesList, setWebsitesList] = useState<any[]>([]);
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
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [crawlUrl, setCrawlUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [preferredLanguage, setPreferredLanguage] = useState("de");
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [profileName, setProfileName] = useState("");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);

  // Check saved auth on mount
  useEffect(() => {
    const token = localStorage.getItem("token");
    const savedUser = localStorage.getItem("user_info");
    const savedOrgs = localStorage.getItem("orgs_info");
    const activeOrgId = localStorage.getItem("active_org_id");

    if (token && savedUser && savedOrgs) {
      try {
        const user = JSON.parse(savedUser);
        const orgs = JSON.parse(savedOrgs);
        setAuth({ user, organizations: orgs, token });
        setPreferredLanguage(user.preferredLanguage || "de");
        setProfileName(user.name || "");
        setProfileAvatarUrl(user.avatarUrl || null);

        const currentOrg = orgs.find((o: any) => o.id === activeOrgId) || orgs[0];
        if (currentOrg) {
          setActiveOrg(currentOrg);
          localStorage.setItem("active_org_id", currentOrg.id);
        }
      } catch (e) {
        localStorage.clear();
      }
    }
  }, []);

  useEffect(() => {
    const language = preferredLanguage as DashboardLanguage;
    const updateLanguage = () => localizeDashboard(language);
    updateLanguage();
    const observer = new MutationObserver(updateLanguage);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [preferredLanguage]);

  // Fetch tenant data when active organization changes
  useEffect(() => {
    if (auth && activeOrg) {
      fetchTenantData();
    }
  }, [activeOrg, activeTab]);

  const showNotify = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4000);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    try {
      const res = await api.post("/auth/login", { email: authEmail, password: authPassword });
      const { user, organizations, token } = res.data;

      localStorage.setItem("token", token);
      document.cookie = `support_auth_token=${encodeURIComponent(token)}; Path=/; SameSite=Lax`;
      localStorage.setItem("user_info", JSON.stringify(user));
      localStorage.setItem("orgs_info", JSON.stringify(organizations));

      setAuth({ user, organizations, token });
      setPreferredLanguage(user.preferredLanguage || "de");
      setProfileName(user.name || "");
      setProfileAvatarUrl(user.avatarUrl || null);
      if (organizations.length > 0) {
        setActiveOrg(organizations[0]);
        localStorage.setItem("active_org_id", organizations[0].id);
      }
      showNotify(`Welcome back, ${user.name}!`);
    } catch (err: any) {
      setAuthError(err.response?.data?.error || "Login failed. Please check your credentials.");
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    try {
      const res = await api.post("/auth/register", {
        name: authName,
        email: authEmail,
        password: authPassword,
        orgName: authOrgName,
      });

      const { user, organization, token } = res.data;
      const orgs = [organization];

      localStorage.setItem("token", token);
      document.cookie = `support_auth_token=${encodeURIComponent(token)}; Path=/; SameSite=Lax`;
      localStorage.setItem("user_info", JSON.stringify(user));
      localStorage.setItem("orgs_info", JSON.stringify(orgs));
      localStorage.setItem("active_org_id", organization.id);

      setAuth({ user, organizations: orgs, token });
      setPreferredLanguage(user.preferredLanguage || "de");
      setProfileName(user.name || "");
      setProfileAvatarUrl(user.avatarUrl || null);
      setActiveOrg(organization);
      showNotify(`Organization ${organization.name} created successfully!`);
    } catch (err: any) {
      setAuthError(err.response?.data?.error || "Registration failed. Please try again.");
    }
  };

  const handleLogout = () => {
    document.cookie = "support_auth_token=; Path=/; Max-Age=0; SameSite=Lax";
    localStorage.clear();
    setAuth(null);
    setActiveOrg(null);
  };

  const fetchTenantData = async () => {
    try {
      if (activeTab === "overview" || activeTab === "analytics") {
        const res = await api.get("/analytics/overview");
        setOverviewMetrics(res.data);
      }

      if (activeTab === "conversations") {
        const res = await api.get("/conversations");
        setConversationsList(res.data);
      }

      if (activeTab === "tickets") {
        const res = await api.get("/tickets");
        setTicketsList(res.data);
      }

      if (activeTab === "knowledge" || activeTab === "websites") {
        const [kbRes, srcRes, webRes] = await Promise.all([
          api.get("/knowledge/bases"),
          api.get("/knowledge/sources"),
          api.get("/knowledge/websites"),
        ]);
        setKnowledgeBases(kbRes.data);
        setKnowledgeSources(srcRes.data);
        setWebsitesList(webRes.data);
        if (kbRes.data.length > 0 && !selectedKbId) {
          setSelectedKbId(kbRes.data[0].id);
        }
      }

      if (activeTab === "assistant" || activeTab === "widget") {
        const res = await api.get("/assistants");
        setAssistantsList(res.data);
        if (res.data.length > 0) setActiveAssistant(res.data[0]);
      }

      if (activeTab === "agents") {
        const res = await api.get("/agents");
        setAgentsList(res.data);
      }

      if (activeTab === "customers") {
        const res = await api.get("/customers");
        setCustomersList(res.data);
      }
    } catch (err: any) {
      console.error("Failed to load tenant data", err);
    }
  };

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
      showNotify(err.response?.data?.error || "Failed to create knowledge base");
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
        content: docContent,
      });
      setDocTitle("");
      setDocContent("");
      showNotify("Document indexed successfully!");
      fetchTenantData();
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
      showNotify("PDF uploaded and indexed successfully!");
      fetchTenantData();
    } catch (err: any) {
      showNotify(err.response?.data?.error || "PDF Upload failed");
    } finally {
      setLoading(false);
    }
  };

  const handleCrawlWebsite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedKbId || !crawlUrl) return;
    setLoading(true);
    try {
      await api.post("/knowledge/crawl", {
        knowledgeBaseId: selectedKbId,
        targetUrl: crawlUrl,
      });
      setCrawlUrl("");
      showNotify("Website crawl background job started!");
      fetchTenantData();
    } catch (err: any) {
      showNotify(err.response?.data?.error || "Crawl request failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectConversation = async (conv: any) => {
    setSelectedConv(conv);
    try {
      const res = await api.get(`/conversations/${conv.id}/messages`);
      setConvMessages(res.data);
    } catch (err) {}
  };

  const handlePreferredLanguageChange = async (language: string) => {
    try {
      await api.patch("/auth/me/preferences", { preferredLanguage: language });
      setPreferredLanguage(language);
      if (auth) {
        const user = { ...auth.user, preferredLanguage: language };
        const nextAuth = { ...auth, user };
        setAuth(nextAuth);
        localStorage.setItem("user_info", JSON.stringify(user));
      }
      showNotify("Dashboard language saved");
    } catch (err: any) {
      showNotify(err.response?.data?.error || "Could not save dashboard language");
    }
  };

  const handleProfileImage = (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1024 * 1024) {
      showNotify("Use a PNG, JPEG, or WebP image up to 1 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setProfileAvatarUrl(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const res = await api.patch("/auth/me/preferences", { name: profileName, avatarUrl: profileAvatarUrl, preferredLanguage });
      if (auth) {
        const user = { ...auth.user, ...res.data };
        setAuth({ ...auth, user });
        localStorage.setItem("user_info", JSON.stringify(user));
      }
      showNotify("Profile saved");
    } catch (err: any) {
      showNotify(err.response?.data?.error || "Could not save profile");
    }
  };

  const handleTranslateMessage = async (message: any) => {
    if (!selectedConv || translations[message.id]) return;
    try {
      const res = await api.post(`/conversations/${selectedConv.id}/messages/${message.id}/translation`, { targetLanguage: preferredLanguage });
      setTranslations((current) => ({ ...current, [message.id]: res.data.translatedContent }));
    } catch (err: any) {
      showNotify(err.response?.data?.error || "Translation failed");
    }
  };

  const handleSendAgentMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConv || !agentMsgInput) return;
    try {
      const res = await api.post(`/conversations/${selectedConv.id}/messages`, { content: agentMsgInput });
      setConvMessages([...convMessages, res.data]);
      setAgentMsgInput("");
      showNotify("Response sent to customer");
    } catch (err: any) {
      showNotify(err.response?.data?.error || "Failed to send message");
    }
  };

  const handleResolveConversation = async (convId: string) => {
    try {
      await api.post(`/conversations/${convId}/resolve`);
      showNotify("Conversation resolved");
      fetchTenantData();
    } catch (err) {}
  };

  const handleSaveAssistantSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAssistant) return;
    try {
      const res = await api.put(`/assistants/${activeAssistant.id}`, activeAssistant);
      setActiveAssistant(res.data);
      showNotify("Assistant settings saved!");
    } catch (err: any) {
      showNotify(err.response?.data?.error || "Failed to save settings");
    }
  };

  const handleRegenerateApiKey = async () => {
    try {
      const res = await api.post("/organizations/api-key");
      setActiveOrg({ ...activeOrg, apiKey: res.data.apiKey });
      showNotify("New Organization API Key generated!");
    } catch (err) {}
  };

  const handleRotateWidgetKey = async () => {
    if (!activeAssistant) return;
    try {
      const res = await api.post(`/assistants/${activeAssistant.id}/widget-key/rotate`);
      setActiveAssistant(res.data);
      setAssistantsList(assistantsList.map((assistant) => assistant.id === res.data.id ? res.data : assistant));
      showNotify("Public widget key rotated. Update every external integration.");
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
      setTicketsList((current) => current.map((ticket) => ticket.id === res.data.id ? { ...ticket, ...res.data } : ticket));
      showNotify(`Ticket #${res.data.ticketNumber} updated`);
    } catch (err: any) {
      showNotify(err.response?.data?.error || "Failed to update ticket");
    }
  };

  const handleAddTicketComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !commentInput.trim()) return;
    try {
      const res = await api.post(`/tickets/${selectedTicket.id}/comments`, { content: commentInput.trim(), isInternal: true });
      setTicketCommentsList((current) => [...current, { ...res.data, author: auth?.user }]);
      setCommentInput("");
      showNotify("Interne Notiz hinzugefügt");
    } catch (err: any) {
      showNotify(err.response?.data?.error || "Kommentar konnte nicht gespeichert werden");
    }
  };

  const handleOpenTicketConversation = async () => {
    if (!selectedTicket?.conversationId) {
      showNotify("Diesem Ticket ist keine Unterhaltung zugeordnet");
      return;
    }
    try {
      const res = await api.get("/conversations");
      const conversation = res.data.find((item: any) => item.id === selectedTicket.conversationId);
      if (!conversation) {
        showNotify("Die zugehörige Unterhaltung ist nicht mehr verfügbar");
        return;
      }
      setConversationsList(res.data);
      setActiveTab("conversations");
      await handleSelectConversation(conversation);
    } catch (err: any) {
      showNotify(err.response?.data?.error || "Unterhaltung konnte nicht geladen werden");
    }
  };

  // --- Render Authentication Screen ---
  if (!auth) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 text-slate-100 font-sans">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-2xl shadow-lg shadow-blue-500/30">
              <Bot className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">SupportAI Platform</h1>
              <p className="text-xs text-slate-400">Multi-Tenant AI Support Engine</p>
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
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Your Full Name</label>
                <input
                  type="text"
                  required
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  placeholder="Jane Doe"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Company / Org Name</label>
                <input
                  type="text"
                  required
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  value={authOrgName}
                  onChange={(e) => setAuthOrgName(e.target.value)}
                  placeholder="Acme Corp"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Work Email</label>
                <input
                  type="email"
                  required
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="jane@acme.com"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Password</label>
                <input
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
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Work Email</label>
                <input
                  type="email"
                  required
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="admin@company.com"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Password</label>
                <input
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
            </form>
          )}

          <div className="mt-6 pt-4 border-t border-slate-800 text-center">
            <button
              onClick={() => {
                setIsRegistering(!isRegistering);
                setAuthError("");
              }}
              className="text-xs text-blue-400 hover:underline"
            >
              {isRegistering ? "Already have an account? Sign In" : "Need an organization account? Register"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const widgetSettings = { ...DEFAULT_WIDGET_SETTINGS, ...(activeAssistant?.widgetSettings || {}) };
  const updateWidgetSetting = (key: string, value: string | number) => {
    if (!activeAssistant) return;
    setActiveAssistant({ ...activeAssistant, widgetSettings: { ...widgetSettings, [key]: value } });
  };

  // --- Main SaaS Dashboard Layout ---
  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed top-4 right-4 z-50 bg-blue-600 text-white px-4 py-2.5 rounded-lg shadow-xl text-sm flex items-center gap-2 animate-bounce">
          <CheckCircle className="w-4 h-4" />
          <span>{notification}</span>
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between shrink-0">
        <div>
          {/* Logo & Tenant Header */}
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shrink-0">
                <Bot className="w-5 h-5" />
              </div>
              <div className="truncate">
                <h2 className="text-sm font-bold truncate text-white">{activeOrg?.name || "Organization"}</h2>
                <span className="text-[10px] bg-blue-950 text-blue-400 px-1.5 py-0.5 rounded font-mono border border-blue-800">
                  {activeOrg?.role || "member"}
                </span>
              </div>
            </div>
          </div>

          {/* Org Selector if multiple */}
          {auth.organizations.length > 1 && (
            <div className="px-3 py-2 border-b border-slate-800">
              <select
                className="w-full bg-slate-800 text-xs text-slate-200 border border-slate-700 rounded px-2 py-1 focus:outline-none"
                value={activeOrg?.id}
                onChange={(e) => {
                  const selected = auth.organizations.find((o) => o.id === e.target.value);
                  if (selected) {
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

          {/* Nav Items */}
          <nav className="p-3 space-y-1">
            {[
              { id: "overview", label: "Overview", icon: BarChart3 },
              { id: "conversations", label: "Conversations Inbox", icon: MessageSquare },
              { id: "tickets", label: "Support Tickets", icon: Ticket },
              { id: "knowledge", label: "Knowledge Bases", icon: BookOpen },
              { id: "websites", label: "Web Crawler", icon: Globe },
              { id: "assistant", label: "AI Assistant Settings", icon: Bot },
              { id: "agents", label: "Support Agents", icon: Users },
              { id: "customers", label: "Customer Directory", icon: UserCheck },
              { id: "analytics", label: "Analytics & Insights", icon: Sparkles },
              { id: "widget", label: "Widget Designer", icon: Sliders },
              { id: "settings", label: "Organization Settings", icon: Settings },
              { id: "profile", label: "My Profile", icon: UserCheck },
            ].map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as any)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    isActive ? "bg-blue-600 text-white font-semibold" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* User Profile & Logout */}
        <div className="p-3 border-t border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="w-7 h-7 overflow-hidden rounded-full bg-slate-700 flex items-center justify-center font-bold text-xs">
              {auth.user.avatarUrl ? <img src={auth.user.avatarUrl} alt="" className="h-full w-full object-cover" /> : auth.user.name.charAt(0)}
            </div>
            <div className="truncate">
              <p className="text-xs font-medium text-slate-200 truncate">{auth.user.name}</p>
              <p className="text-[10px] text-slate-500 truncate">{auth.user.email}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            title="Sign Out"
            className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 bg-slate-950 overflow-y-auto p-6">
        {activeTab === "profile" && (
          <div className="mx-auto max-w-2xl space-y-6">
            <div><h1 className="text-xl font-bold text-white">My Profile</h1><p className="text-xs text-slate-400">Manage your name, profile image, and preferred dashboard language.</p></div>
            <form onSubmit={handleSaveProfile} className="space-y-5 rounded-xl border border-slate-800 bg-slate-900 p-6">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 overflow-hidden rounded-full bg-slate-700 text-xl font-bold flex items-center justify-center">
                  {profileAvatarUrl ? <img src={profileAvatarUrl} alt="Profile preview" className="h-full w-full object-cover" /> : (profileName || auth.user.name).charAt(0)}
                </div>
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-300">Profile image</label>
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => handleProfileImage(event.target.files?.[0])} className="block text-xs text-slate-400 file:mr-3 file:rounded file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-xs file:text-slate-100" />
                  {profileAvatarUrl && <button type="button" onClick={() => setProfileAvatarUrl(null)} className="text-xs text-red-300 hover:text-red-200">Remove image</button>}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">Name</label>
                <input required minLength={2} maxLength={100} value={profileName} onChange={(event) => setProfileName(event.target.value)} className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-300">Preferred language</label>
                <select value={preferredLanguage} onChange={(event) => setPreferredLanguage(event.target.value)} className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100"><option value="de">Deutsch</option><option value="en">English</option><option value="es">Español</option><option value="fr">Français</option></select>
              </div>
              <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">Save profile</button>
            </form>
          </div>
        )}
        {/* TAB 1: OVERVIEW */}
        {activeTab === "overview" && (
          <div className="space-y-6 max-w-7xl mx-auto">
            <div>
              <h1 className="text-xl font-bold text-white">Platform Dashboard Overview</h1>
              <p className="text-xs text-slate-400">Multi-tenant AI support agent performance and live status</p>
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                <span className="text-xs text-slate-400 font-medium">Total Conversations</span>
                <p className="text-2xl font-bold text-white mt-1">{overviewMetrics?.totalConversations || 0}</p>
                <div className="mt-2 text-[10px] text-emerald-400 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> 100% tenant isolated
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                <span className="text-xs text-slate-400 font-medium">AI Resolution Rate</span>
                <p className="text-2xl font-bold text-emerald-400 mt-1">{overviewMetrics?.resolutionRate || 100}%</p>
                <span className="text-[10px] text-slate-500">Autonomous resolution without handoff</span>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                <span className="text-xs text-slate-400 font-medium">Human Handoffs</span>
                <p className="text-2xl font-bold text-amber-400 mt-1">{overviewMetrics?.handoffs || 0}</p>
                <span className="text-[10px] text-slate-500">Escalated to human support</span>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                <span className="text-xs text-slate-400 font-medium">Open Support Tickets</span>
                <p className="text-2xl font-bold text-blue-400 mt-1">{overviewMetrics?.openTickets || 0}</p>
                <span className="text-[10px] text-slate-500">Active customer tickets</span>
              </div>
            </div>

            {/* Content stats & Unanswered queries */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
                <h3 className="text-sm font-semibold text-white mb-3">Knowledge Base Coverage</h3>
                <div className="flex justify-around text-center py-4 border-y border-slate-800">
                  <div>
                    <span className="text-xs text-slate-400">Sources</span>
                    <p className="text-xl font-bold text-white">{overviewMetrics?.totalKnowledgeSources || 0}</p>
                  </div>
                  <div>
                    <span className="text-xs text-slate-400">pgvector Chunks</span>
                    <p className="text-xl font-bold text-blue-400">{overviewMetrics?.totalDocumentChunks || 0}</p>
                  </div>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
                <h3 className="text-sm font-semibold text-white mb-3">Recent Unanswered Queries</h3>
                <div className="space-y-2">
                  {overviewMetrics?.unansweredQuestions?.length > 0 ? (
                    overviewMetrics.unansweredQuestions.map((q: any) => (
                      <div key={q.id} className="p-2.5 bg-slate-800/60 rounded text-xs text-slate-300">
                        "{q.question}"
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-slate-500 italic py-4">No recent unanswered queries detected.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ANALYTICS & INSIGHTS */}
        {activeTab === "analytics" && (
          <div className="space-y-6 max-w-7xl mx-auto">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold text-white">Analytics & Insights</h1>
                <p className="text-xs text-slate-400">Measure support workload, AI resolution, handoffs, and knowledge-base coverage.</p>
              </div>
              <button onClick={fetchTenantData} className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800">Refresh data</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[
                ["Conversations", overviewMetrics?.totalConversations || 0, "text-blue-400"],
                ["AI Resolution Rate", `${overviewMetrics?.resolutionRate ?? 0}%`, "text-emerald-400"],
                ["Human Handoffs", overviewMetrics?.handoffs || 0, "text-amber-400"],
                ["Open Tickets", overviewMetrics?.openTickets || 0, "text-purple-400"],
              ].map(([label, value, color]) => (
                <div key={label as string} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                  <p className="text-xs text-slate-400">{label}</p>
                  <p className={`mt-2 text-3xl font-bold ${color}`}>{value}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                <p className="text-xs font-medium text-slate-400">AI resolution</p>
                <div className="mt-4 flex items-center gap-5">
                  <div className="grid h-24 w-24 place-items-center rounded-full" style={{ background: `conic-gradient(#10b981 ${(overviewMetrics?.resolutionRate ?? 0) * 3.6}deg, #1e293b 0deg)` }}>
                    <div className="grid h-16 w-16 place-items-center rounded-full bg-slate-900 text-center"><span className="text-lg font-bold text-white">{overviewMetrics?.resolutionRate ?? 0}%</span></div>
                  </div>
                  <p className="max-w-[160px] text-xs leading-relaxed text-slate-400">Share of conversations resolved without waiting for a human agent.</p>
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                <p className="text-xs font-medium text-slate-400">Human workload</p>
                <p className="mt-3 text-3xl font-bold text-amber-400">{overviewMetrics?.handoffs || 0}</p>
                <p className="mt-1 text-xs text-slate-500">conversations currently requiring agent attention</p>
                <div className="mt-4 h-2 overflow-hidden rounded bg-slate-800"><div className="h-full rounded bg-amber-400" style={{ width: `${Math.min(100, ((overviewMetrics?.handoffs || 0) / Math.max(overviewMetrics?.totalConversations || 1, 1)) * 100)}%` }} /></div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                <p className="text-xs font-medium text-slate-400">Knowledge readiness</p>
                <p className="mt-3 text-3xl font-bold text-blue-400">{overviewMetrics?.totalKnowledgeSources || 0}</p>
                <p className="mt-1 text-xs text-slate-500">sources indexed into {overviewMetrics?.totalDocumentChunks || 0} searchable chunks</p>
                <div className="mt-4 flex gap-1">{Array.from({ length: 10 }).map((_, index) => <span key={index} className={`h-2 flex-1 rounded ${index < Math.min(10, overviewMetrics?.totalKnowledgeSources || 0) ? "bg-blue-400" : "bg-slate-800"}`} />)}</div>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                <h2 className="text-sm font-semibold text-white">Conversation states</h2>
                <div className="mt-4 space-y-3">
                  {Object.entries(overviewMetrics?.stateBreakdown || {}).map(([state, count]) => {
                    const total = overviewMetrics?.totalConversations || 1;
                    const width = Math.max(3, (Number(count) / total) * 100);
                    const stateLabels: Record<string, string> = { AI_ACTIVE: "AI active", WAITING_FOR_AGENT: "Waiting for agent", AGENT_ACTIVE: "Agent active", RESOLVED: "Resolved" };
                    const colors: Record<string, string> = { AI_ACTIVE: "bg-blue-500", WAITING_FOR_AGENT: "bg-amber-400", AGENT_ACTIVE: "bg-violet-500", RESOLVED: "bg-emerald-500" };
                    return <div key={state}><div className="mb-1 flex justify-between text-xs text-slate-400"><span>{stateLabels[state] || state.replaceAll("_", " ")}</span><span>{String(count)} · {Math.round((Number(count) / total) * 100)}%</span></div><div className="h-2 overflow-hidden rounded bg-slate-800"><div className={`h-full rounded ${colors[state] || "bg-slate-500"}`} style={{ width: `${width}%` }} /></div></div>;
                  })}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                <h2 className="text-sm font-semibold text-white">Detected languages</h2>
                <div className="mt-4 space-y-3">
                  {overviewMetrics?.languageBreakdown?.length ? overviewMetrics.languageBreakdown.map((entry: any) => { const total = overviewMetrics?.totalConversations || 1; const share = Math.round((entry.count / total) * 100); return <div key={entry.language} className="rounded bg-slate-800/60 px-3 py-2 text-xs"><div className="flex justify-between"><span className="uppercase text-slate-300">{entry.language}</span><span className="font-semibold text-white">{entry.count} · {share}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-700"><div className="h-full rounded bg-cyan-400" style={{ width: `${share}%` }} /></div></div>; }) : <p className="text-xs text-slate-500">No conversation data yet.</p>}
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-white">Questions needing attention</h2><span className="rounded bg-amber-950 px-2 py-1 text-[10px] font-semibold text-amber-300">{overviewMetrics?.unansweredQuestions?.length || 0} open</span></div>
              <div className="mt-3 space-y-2">{overviewMetrics?.unansweredQuestions?.length ? overviewMetrics.unansweredQuestions.map((question: any) => <div key={question.id} className="flex items-start justify-between gap-4 rounded border border-amber-900/50 bg-amber-950/30 px-3 py-3 text-xs text-amber-100"><span>{question.question}</span><span className="shrink-0 text-[10px] text-amber-400">{question.timestamp ? new Date(question.timestamp).toLocaleString() : ""}</span></div>) : <p className="text-xs text-slate-500">No unanswered questions or pending handoffs.</p>}</div>
            </div>
          </div>
        )}

        {/* SUPPORT AGENTS */}
        {activeTab === "agents" && (
          <div className="space-y-6 max-w-5xl mx-auto">
            <div><h1 className="text-xl font-bold text-white">Support Agents</h1><p className="text-xs text-slate-400">Team members who can handle escalated customer conversations.</p></div>
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
              <table className="w-full text-left text-xs"><thead className="bg-slate-800/80 text-slate-400"><tr><th className="p-3">Agent</th><th className="p-3">Email</th><th className="p-3">Role</th><th className="p-3">Access</th></tr></thead><tbody className="divide-y divide-slate-800">{agentsList.length ? agentsList.map((agent) => <tr key={agent.id} className="text-slate-300"><td className="p-3 font-medium text-white">{agent.name}</td><td className="p-3">{agent.email}</td><td className="p-3 uppercase">{agent.role}</td><td className="p-3"><span className="rounded bg-emerald-950 px-2 py-1 text-[10px] text-emerald-300">ACTIVE</span></td></tr>) : <tr><td colSpan={4} className="p-8 text-center text-slate-500">No support agents have been added to this organization.</td></tr>}</tbody></table>
            </div>
            <p className="rounded-lg border border-blue-900 bg-blue-950/30 p-3 text-xs text-blue-200">Agents can claim and reply to conversations from the Conversations Inbox. Add users to the organization with an <code>agent</code>, <code>admin</code>, or <code>owner</code> membership role.</p>
          </div>
        )}

        {/* CUSTOMER DIRECTORY */}
        {activeTab === "customers" && (
          <div className="space-y-6 max-w-6xl mx-auto">
            <div><h1 className="text-xl font-bold text-white">Customer Directory</h1><p className="text-xs text-slate-400">Customers are created automatically when they start a widget session.</p></div>
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
              <table className="w-full text-left text-xs"><thead className="bg-slate-800/80 text-slate-400"><tr><th className="p-3">Customer</th><th className="p-3">Email</th><th className="p-3">External ID</th><th className="p-3">Joined</th></tr></thead><tbody className="divide-y divide-slate-800">{customersList.length ? customersList.map((customer) => <tr key={customer.id} className="text-slate-300"><td className="p-3 font-medium text-white">{customer.name || "Website visitor"}</td><td className="p-3">{customer.email || "—"}</td><td className="p-3 font-mono text-slate-500">{customer.externalId || "—"}</td><td className="p-3 text-slate-500">{new Date(customer.createdAt).toLocaleDateString()}</td></tr>) : <tr><td colSpan={4} className="p-8 text-center text-slate-500">No customers yet. Embed the widget or create a test session to see customers here.</td></tr>}</tbody></table>
            </div>
          </div>
        )}

        {/* TAB 2: CONVERSATIONS INBOX */}
        {activeTab === "conversations" && (
          <div className="h-full flex gap-4 max-w-7xl mx-auto">
            {/* Conversation List */}
            <div className="w-1/3 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
              <div className="p-3 border-b border-slate-800 font-semibold text-sm">Active Conversations</div>
              <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
                {conversationsList.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => handleSelectConversation(conv)}
                    className={`w-full p-3 text-left transition-colors flex flex-col gap-1 ${
                      selectedConv?.id === conv.id ? "bg-blue-950/60 border-l-4 border-blue-500" : "hover:bg-slate-800/40"
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold text-slate-200">{conv.customer?.name || "Visitor"}</span>
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

            {/* Conversation Detail & Live Agent Handoff Chat */}
            <div className="w-2/3 bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
              {selectedConv ? (
                <>
                  <div className="p-3 border-b border-slate-800 flex justify-between items-center bg-slate-900">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-200">{selectedConv.customer?.name}</h3>
                      <p className="text-[10px] text-slate-400">{selectedConv.customer?.email}</p>
                    </div>
                    <button
                      onClick={() => handleResolveConversation(selectedConv.id)}
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded"
                    >
                      Mark Resolved
                    </button>
                  </div>

                  <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-950/40">
                    {convMessages.map((m) => (
                      <div
                        key={m.id}
                        className={`max-w-md p-3 rounded-xl text-xs ${
                          m.senderType === "customer"
                            ? "bg-blue-600 text-white ml-auto rounded-br-none"
                            : m.senderType === "agent"
                            ? "bg-purple-700 text-white ml-auto rounded-br-none"
                            : "bg-slate-800 text-slate-200 mr-auto rounded-bl-none border border-slate-700"
                        }`}
                      >
                        <div className="font-semibold text-[10px] opacity-75 mb-1">{m.senderName || m.senderType}</div>
                        <p className="leading-relaxed">{m.content}</p>
                        {m.senderType === "customer" && (
                          <div className="mt-2 border-t border-white/15 pt-2">
                            {translations[m.id] ? (
                              <p className="leading-relaxed text-white/80"><span className="mr-1 text-[10px] font-semibold uppercase opacity-70">{preferredLanguage}</span>{translations[m.id]}</p>
                            ) : (
                              <button type="button" onClick={() => handleTranslateMessage(m)} className="text-[10px] font-medium text-blue-200 hover:text-white">Übersetzen ({preferredLanguage.toUpperCase()})</button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <form onSubmit={handleSendAgentMessage} className="p-3 border-t border-slate-800 bg-slate-900 flex gap-2">
                    <input
                      type="text"
                      className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                      placeholder="Type agent response..."
                      value={agentMsgInput}
                      onChange={(e) => setAgentMsgInput(e.target.value)}
                    />
                    <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded">
                      Send Reply
                    </button>
                  </form>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-slate-500 text-xs">
                  Select a conversation from the left inbox to respond
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: TICKETS */}
        {activeTab === "tickets" && (
          <div className="space-y-4 max-w-7xl mx-auto">
            <div>
              <h1 className="text-xl font-bold text-white">Customer Support Tickets</h1>
              <p className="mt-1 text-xs text-slate-400">KI-Eskalationen werden automatisch als offene Tickets in diese Warteschlange übernommen.</p>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
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
                  {ticketsList.length === 0 && (
                    <tr><td colSpan={6} className="p-8 text-center text-slate-500">Keine offenen Tickets. Neue KI-Eskalationen erscheinen automatisch hier.</td></tr>
                  )}
                  {ticketsList.map((tk) => (
                    <tr key={tk.id} onClick={() => handleSelectTicket(tk)} className={`cursor-pointer hover:bg-slate-800/40 ${selectedTicket?.id === tk.id ? "bg-blue-950/20" : ""}`}>
                      <td className="p-3 font-mono font-bold text-blue-400">#{tk.ticketNumber}</td>
                      <td className="p-3 font-medium text-slate-200"><div>{tk.subject}</div>{Array.isArray(tk.tags) && tk.tags.includes("ai-escalation") && <span className="mt-1 inline-block rounded border border-violet-800 bg-violet-950/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-violet-300">KI-Eskalation</span>}</td>
                      <td className="p-3">{tk.customer?.name || "Visitor"}</td>
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
                        <span className="px-2 py-0.5 bg-blue-950 text-blue-400 rounded text-[10px] border border-blue-800 uppercase font-semibold">
                          {tk.status}
                        </span>
                      </td>
                      <td className="p-3 text-slate-500">{new Date(tk.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <aside className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              {selectedTicket ? (
                <div className="space-y-4">
                  <div><p className="text-[10px] font-semibold uppercase text-blue-400">Ticket #{selectedTicket.ticketNumber}</p><h2 className="mt-1 text-sm font-semibold text-white">{selectedTicket.subject}</h2></div>
                  <p className="whitespace-pre-wrap text-xs leading-5 text-slate-300">{selectedTicket.description || "Keine zusätzliche Beschreibung."}</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedTicket.conversationId && <button onClick={handleOpenTicketConversation} className="rounded border border-violet-800 bg-violet-950/50 px-2.5 py-1.5 text-[11px] font-semibold text-violet-300 hover:bg-violet-950">Unterhaltung öffnen</button>}
                    {selectedTicket.status !== "in_progress" && <button onClick={() => handleTicketStatusChange("in_progress")} className="rounded bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-500">Bearbeiten</button>}
                    {selectedTicket.status !== "resolved" && <button onClick={() => handleTicketStatusChange("resolved")} className="rounded border border-emerald-800 bg-emerald-950/50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-950">Lösen</button>}
                  </div>
                  <div className="border-t border-slate-800 pt-3"><p className="mb-2 text-[10px] font-semibold uppercase text-slate-500">Interne Kommentare</p>{ticketCommentsList.length ? ticketCommentsList.map((comment) => <div key={comment.id} className="mb-2 rounded bg-slate-800/70 p-2 text-[11px] text-slate-300"><p>{comment.content}</p><p className="mt-1 text-[10px] text-slate-500">{comment.author?.name || "Support"}</p></div>) : <p className="mb-2 text-xs text-slate-500">Noch keine Kommentare.</p>}<form onSubmit={handleAddTicketComment} className="mt-3 flex gap-2"><input value={commentInput} onChange={(event) => setCommentInput(event.target.value)} maxLength={2000} placeholder="Interne Notiz hinzufügen…" className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-[11px] text-slate-100 outline-none focus:border-blue-500" /><button type="submit" className="rounded bg-slate-700 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-600">Notiz</button></form></div>
                </div>
              ) : <p className="text-xs leading-5 text-slate-500">Wähle ein Ticket, um Anfrage, Status und interne Kommentare zu sehen.</p>}
            </aside>
            </div>
          </div>
        )}

        {/* TAB 4: KNOWLEDGE BASES & DOCUMENTS */}
        {activeTab === "knowledge" && (
          <div className="space-y-6 max-w-7xl mx-auto">
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-xl font-bold text-white">Knowledge Base & PDF Processing</h1>
                <p className="text-xs text-slate-400">Upload documentation, FAQs, and PDFs to train your AI assistant</p>
              </div>

              {/* Create KB form */}
              <form onSubmit={handleCreateKnowledgeBase} className="flex gap-2">
                <input
                  type="text"
                  placeholder="New Knowledge Base Name"
                  className="bg-slate-900 border border-slate-800 rounded px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
                  value={newKbName}
                  onChange={(e) => setNewKbName(e.target.value)}
                />
                <button type="submit" className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> Create KB
                </button>
              </form>
            </div>

            {/* Active KB Selector */}
            {knowledgeBases.length > 0 && (
              <div className="flex gap-2 border-b border-slate-800 pb-2">
                {knowledgeBases.map((kb) => (
                  <button
                    key={kb.id}
                    onClick={() => setSelectedKbId(kb.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      selectedKbId === kb.id ? "bg-blue-600 text-white" : "bg-slate-900 text-slate-400 hover:bg-slate-800"
                    }`}
                  >
                    {kb.name}
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Manual Document / FAQ Ingestion */}
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-4">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-400" /> Manual Text / FAQ Ingestion
                </h3>
                <form onSubmit={handleAddTextDocument} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Title</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Refund Policy FAQ"
                      className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none"
                      value={docTitle}
                      onChange={(e) => setDocTitle(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Content</label>
                    <textarea
                      rows={5}
                      required
                      placeholder="Enter documentation body or FAQ answers..."
                      className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none"
                      value={docContent}
                      onChange={(e) => setDocContent(e.target.value)}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded text-xs transition-colors"
                  >
                    {loading ? "Processing pgvector Embeddings..." : "Chunk & Embed Content"}
                  </button>
                </form>
              </div>

              {/* PDF Ingestion Pipeline */}
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-4">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Upload className="w-4 h-4 text-emerald-400" /> PDF Document Processing
                </h3>
                <form onSubmit={handleUploadPdf} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">PDF File</label>
                    <input
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
                    {loading ? "Extracting & Embedding PDF..." : "Upload & Process PDF"}
                  </button>
                </form>
              </div>
            </div>

            {/* Indexed Sources Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-slate-800 font-semibold text-sm">Indexed Knowledge Sources</div>
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-800/80 text-slate-400 uppercase text-[10px] font-semibold">
                  <tr>
                    <th className="p-3">Title</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Chunks</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {knowledgeSources.map((src) => (
                    <tr key={src.id} className="hover:bg-slate-800/40">
                      <td className="p-3 font-medium text-slate-200">{src.title}</td>
                      <td className="p-3 uppercase font-mono text-[10px] text-blue-400">{src.type}</td>
                      <td className="p-3 font-bold">{src.chunkCount}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] uppercase font-semibold ${
                            src.status === "completed" ? "bg-emerald-950 text-emerald-400 border border-emerald-800" : "bg-amber-950 text-amber-400"
                          }`}
                        >
                          {src.status}
                        </span>
                      </td>
                      <td className="p-3 text-slate-500">{new Date(src.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: WEBSITE CRAWLER */}
        {activeTab === "websites" && (
          <div className="space-y-6 max-w-7xl mx-auto">
            <div>
              <h1 className="text-xl font-bold text-white">Recursive Website Crawler</h1>
              <p className="text-xs text-slate-400">Crawl public web pages with SSRF protection and automatic chunk indexing</p>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl max-w-xl space-y-4">
              <form onSubmit={handleCrawlWebsite} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Target Website Root URL</label>
                  <input
                    type="url"
                    required
                    placeholder="https://docs.yourcompany.com"
                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none"
                    value={crawlUrl}
                    onChange={(e) => setCrawlUrl(e.target.value)}
                  />
                  <p className="text-[10px] text-slate-500 mt-1">SSRF Protected: Private IP ranges are automatically blocked.</p>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded text-xs transition-colors"
                >
                  {loading ? "Launching Crawl Worker..." : "Start Website Crawl"}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 6: AI ASSISTANT SETTINGS */}
        {activeTab === "assistant" && activeAssistant && (
          <div className="space-y-6 max-w-4xl mx-auto">
            <div>
              <h1 className="text-xl font-bold text-white">AI Assistant Configuration</h1>
              <p className="text-xs text-slate-400">Richte mehrere Provider und Modelle ein und wähle die aktive Konfiguration für Kundenanfragen.</p>
            </div>

            <div className="rounded-xl border border-blue-800/70 bg-blue-950/30 p-4 flex items-center justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-wide text-blue-300">Aktiv für neue Antworten</p><p className="mt-1 text-sm font-semibold text-white">{(activeAssistant.modelProfiles || []).find((profile: any) => profile.id === activeAssistant.activeModelProfileId)?.label || "Standard-Konfiguration"}</p><p className="text-xs text-slate-400">{(activeAssistant.modelProfiles || []).find((profile: any) => profile.id === activeAssistant.activeModelProfileId)?.provider || activeAssistant.modelProvider} · {(activeAssistant.modelProfiles || []).find((profile: any) => profile.id === activeAssistant.activeModelProfileId)?.modelName || activeAssistant.modelName}</p></div><span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">Live</span></div>

            <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-5">
              <div className="flex items-center justify-between gap-4"><div><h2 className="text-sm font-semibold text-white">Modell- & Provider-Konfigurationen</h2><p className="mt-1 text-xs text-slate-500">API-Schlüssel werden verschlüsselt gespeichert und nach dem Speichern nicht erneut angezeigt.</p></div><button type="button" disabled={(activeAssistant.modelProfiles || []).length >= 8} onClick={() => { const id = `model_${Date.now().toString(36)}`; setActiveAssistant({ ...activeAssistant, modelProfiles: [...(activeAssistant.modelProfiles || []), { id, label: "Neue Konfiguration", provider: "openai", modelName: "gpt-4o-mini", baseUrl: "", apiKey: "" }] }); }} className="shrink-0 rounded bg-slate-700 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-600 disabled:opacity-50"><Plus className="mr-1 inline h-3.5 w-3.5" /> Hinzufügen</button></div>
              {(activeAssistant.modelProfiles || []).length === 0 && <div className="rounded-lg border border-dashed border-slate-700 p-4 text-xs text-slate-400">Zurzeit wird die Standard-Konfiguration unten verwendet. Füge eine Konfiguration hinzu, um etwa OpenAI, Claude, Gemini oder ein lokales Modell hinterlegen zu können.</div>}
              {(activeAssistant.modelProfiles || []).map((profile: any, index: number) => <div key={profile.id} className={`rounded-lg border p-4 ${activeAssistant.activeModelProfileId === profile.id ? "border-blue-600 bg-blue-950/20" : "border-slate-700 bg-slate-800/50"}`}><div className="mb-3 flex items-center justify-between gap-2"><label className="flex items-center gap-2 text-xs font-semibold text-slate-200"><input type="radio" name="active-model-profile" checked={activeAssistant.activeModelProfileId === profile.id} onChange={() => setActiveAssistant({ ...activeAssistant, activeModelProfileId: profile.id })} /> Diese Konfiguration aktiv verwenden</label><button type="button" onClick={() => { const modelProfiles = (activeAssistant.modelProfiles || []).filter((item: any) => item.id !== profile.id); setActiveAssistant({ ...activeAssistant, modelProfiles, activeModelProfileId: activeAssistant.activeModelProfileId === profile.id ? null : activeAssistant.activeModelProfileId }); }} className="text-slate-500 hover:text-red-300" title="Konfiguration entfernen"><Trash2 className="h-4 w-4" /></button></div><div className="grid gap-3 md:grid-cols-2"><label><span className="mb-1 block text-[11px] font-medium text-slate-400">Name der Konfiguration</span><input value={profile.label || ""} maxLength={60} onChange={(e) => setActiveAssistant({ ...activeAssistant, modelProfiles: (activeAssistant.modelProfiles || []).map((item: any) => item.id === profile.id ? { ...item, label: e.target.value } : item) })} className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100" /></label><label><span className="mb-1 block text-[11px] font-medium text-slate-400">Provider</span><select value={profile.provider} onChange={(e) => setActiveAssistant({ ...activeAssistant, modelProfiles: (activeAssistant.modelProfiles || []).map((item: any) => item.id === profile.id ? { ...item, provider: e.target.value } : item) })} className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100"><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="google">Google Gemini</option><option value="nvidia">NVIDIA NIM</option><option value="local">Local / Ollama / LocalAI</option></select></label><label><span className="mb-1 block text-[11px] font-medium text-slate-400">Modell</span><input value={profile.modelName || ""} maxLength={160} placeholder="z. B. gpt-4o-mini" onChange={(e) => setActiveAssistant({ ...activeAssistant, modelProfiles: (activeAssistant.modelProfiles || []).map((item: any) => item.id === profile.id ? { ...item, modelName: e.target.value } : item) })} className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100" /></label><label><span className="mb-1 block text-[11px] font-medium text-slate-400">API-Schlüssel {profile.apiKeyConfigured ? "(gespeichert)" : ""}</span><input type="password" value={profile.apiKey || ""} placeholder={profile.apiKeyConfigured ? "Unverändert lassen" : "API-Schlüssel eingeben"} onChange={(e) => setActiveAssistant({ ...activeAssistant, modelProfiles: (activeAssistant.modelProfiles || []).map((item: any) => item.id === profile.id ? { ...item, apiKey: e.target.value } : item) })} className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100" /></label>{profile.provider === "local" && <label className="md:col-span-2"><span className="mb-1 block text-[11px] font-medium text-slate-400">Lokale Base URL</span><input value={profile.baseUrl || ""} placeholder="http://localhost:11434/v1" onChange={(e) => setActiveAssistant({ ...activeAssistant, modelProfiles: (activeAssistant.modelProfiles || []).map((item: any) => item.id === profile.id ? { ...item, baseUrl: e.target.value } : item) })} className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100" /></label>}</div><p className="mt-3 text-[10px] text-slate-500">Konfiguration {index + 1} · Änderungen mit „Save Universal AI Gateway Settings“ speichern.</p></div>)}
            </div>

            <form onSubmit={handleSaveAssistantSettings} className="bg-slate-900 border border-slate-800 p-6 rounded-xl space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Assistant Name</label>
                  <input
                    type="text"
                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none"
                    value={activeAssistant.name || ""}
                    onChange={(e) => setActiveAssistant({ ...activeAssistant, name: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">AI Provider Gateway</label>
                  <select
                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none font-semibold text-blue-400"
                    value={activeAssistant.modelProvider || "openai"}
                    onChange={(e) => setActiveAssistant({ ...activeAssistant, modelProvider: e.target.value })}
                  >
                    <option value="openai">OpenAI (GPT-4o / GPT-4o-mini)</option>
                    <option value="anthropic">Anthropic (Claude 3.5 Sonnet / Haiku / Opus)</option>
                    <option value="google">Google Gemini (Gemini 1.5 Flash / Pro / 2.0)</option>
                    <option value="nvidia">NVIDIA NIM (Llama 3.1 8B / 70B)</option>
                    <option value="local">Local / Ollama / LocalAI (OpenAI-compatible)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Model Name</label>
                  <input
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
                    onChange={(e) => setActiveAssistant({ ...activeAssistant, modelName: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Custom API Key (Optional Override)</label>
                  <input
                    type="password"
                    placeholder="sk-..."
                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none font-mono text-slate-200"
                    value={activeAssistant.apiKey || ""}
                    onChange={(e) => setActiveAssistant({ ...activeAssistant, apiKey: e.target.value })}
                  />
                </div>
              </div>

              {activeAssistant.modelProvider === "local" && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Custom Endpoint Base URL (Local/Ollama/LocalAI)</label>
                  <input
                    type="text"
                    placeholder="http://localhost:11434/v1"
                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none font-mono text-amber-400"
                    value={activeAssistant.baseUrl || ""}
                    onChange={(e) => setActiveAssistant({ ...activeAssistant, baseUrl: e.target.value })}
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Specify your custom Ollama or LocalAI OpenAI-compatible API base URL.</p>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Temperature ({activeAssistant.temperature})</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  className="w-full"
                  value={activeAssistant.temperature || 0.2}
                  onChange={(e) => setActiveAssistant({ ...activeAssistant, temperature: parseFloat(e.target.value) })}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">System Prompt Guardrails</label>
                <textarea
                  rows={4}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs focus:outline-none"
                  value={activeAssistant.systemPrompt || ""}
                  onChange={(e) => setActiveAssistant({ ...activeAssistant, systemPrompt: e.target.value })}
                />
              </div>

              <button type="submit" className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded text-xs">
                Save Universal AI Gateway Settings
              </button>
            </form>
          </div>
        )}

        {/* TAB 7: EMBEDDABLE WIDGET */}
        {activeTab === "widget" && activeOrg && activeAssistant && (
          <div className="space-y-6 max-w-4xl mx-auto">
            <div>
              <h1 className="text-xl font-bold text-white">Widget Designer</h1>
              <p className="text-xs text-slate-400">Gestalte das Kunden-Chatfenster und sieh jede Änderung sofort in der Vorschau.</p>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
              <form onSubmit={handleSaveAssistantSettings} className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-5">
                <div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold text-white">Erscheinungsbild</h2><p className="text-xs text-slate-500 mt-1">Die Einstellungen gelten für alle eingebundenen Widgets dieses Assistenten.</p></div><button type="submit" className="rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500">Design speichern</button></div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    ["primaryColor", "Akzentfarbe"], ["backgroundColor", "Chat-Hintergrund"], ["surfaceColor", "Flächen"], ["agentBubbleColor", "KI-Nachrichten"], ["textColor", "Textfarbe"],
                  ].map(([key, label]) => <label key={key} className="space-y-1"><span className="block text-[11px] font-medium text-slate-400">{label}</span><div className="flex rounded border border-slate-700 bg-slate-800 p-1"><input type="color" value={String(widgetSettings[key as keyof typeof widgetSettings])} onChange={(e) => updateWidgetSetting(key, e.target.value)} className="h-7 w-9 cursor-pointer bg-transparent" /><input value={String(widgetSettings[key as keyof typeof widgetSettings])} onChange={(e) => updateWidgetSetting(key, e.target.value)} className="min-w-0 flex-1 bg-transparent px-1 text-xs text-slate-200 outline-none" /></div></label>)}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1"><span className="block text-[11px] font-medium text-slate-400">Schriftart</span><select value={widgetSettings.fontFamily} onChange={(e) => updateWidgetSetting("fontFamily", e.target.value)} className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100"><option value="sans">Modern Sans</option><option value="serif">Klassisch Serif</option><option value="mono">Monospace</option></select></label>
                  <label className="space-y-1"><span className="block text-[11px] font-medium text-slate-400">Position</span><select value={widgetSettings.position} onChange={(e) => updateWidgetSetting("position", e.target.value)} className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100"><option value="bottom-right">Unten rechts</option><option value="bottom-left">Unten links</option></select></label>
                  <label className="space-y-1"><span className="block text-[11px] font-medium text-slate-400">Überschrift</span><input maxLength={80} value={widgetSettings.headerTitle} placeholder={activeAssistant.name} onChange={(e) => updateWidgetSetting("headerTitle", e.target.value)} className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100" /></label>
                  <label className="space-y-1"><span className="block text-[11px] font-medium text-slate-400">Launcher-Symbol</span><input maxLength={4} value={widgetSettings.launcherIcon} onChange={(e) => updateWidgetSetting("launcherIcon", e.target.value)} className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100" /></label>
                  <label className="space-y-1"><span className="block text-[11px] font-medium text-slate-400">Eingabe-Hinweis</span><input maxLength={120} value={widgetSettings.inputPlaceholder} onChange={(e) => updateWidgetSetting("inputPlaceholder", e.target.value)} className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100" /></label>
                  <label className="space-y-1"><span className="block text-[11px] font-medium text-slate-400">Senden-Text</span><input maxLength={30} value={widgetSettings.sendLabel} onChange={(e) => updateWidgetSetting("sendLabel", e.target.value)} className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-100" /></label>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {[["borderRadius", "Fenster-Rundung", 0, 32], ["launcherSize", "Button-Größe", 44, 80], ["windowWidth", "Fenster-Breite", 300, 520], ["offset", "Abstand zum Rand", 12, 48]].map(([key, label, min, max]) => <label key={String(key)} className="space-y-2"><span className="flex justify-between text-[11px] font-medium text-slate-400"><span>{label}</span><span>{widgetSettings[key as keyof typeof widgetSettings]} px</span></span><input type="range" min={Number(min)} max={Number(max)} value={Number(widgetSettings[key as keyof typeof widgetSettings])} onChange={(e) => updateWidgetSetting(String(key), Number(e.target.value))} className="w-full accent-blue-500" /></label>)}
                </div>
              </form>

              <div className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="text-sm font-semibold text-white">Live-Vorschau</h2><p className="mt-1 text-xs text-slate-500">So erscheint der Chat auf deiner Website.</p><div className="relative mt-4 h-[500px] overflow-hidden rounded-lg border border-slate-700 bg-slate-800" style={{ background: "linear-gradient(135deg, #e2e8f0, #cbd5e1)" }}><div className="absolute inset-5 rounded-md border border-white/60 bg-white/30" /><div className={`absolute bottom-4 ${widgetSettings.position === "bottom-left" ? "left-4" : "right-4"}`}><div className="mb-3 w-[280px] overflow-hidden shadow-2xl" style={{ borderRadius: Number(widgetSettings.borderRadius), fontFamily: widgetSettings.fontFamily === "serif" ? "Georgia, serif" : widgetSettings.fontFamily === "mono" ? "monospace" : "Arial, sans-serif", backgroundColor: widgetSettings.surfaceColor }}><div className="px-4 py-3 text-sm font-semibold text-white" style={{ backgroundColor: widgetSettings.primaryColor }}>{widgetSettings.headerTitle || activeAssistant.name}<span className="float-right">×</span></div><div className="space-y-3 p-3" style={{ backgroundColor: widgetSettings.backgroundColor }}><div className="max-w-[82%] rounded-xl rounded-bl-sm px-3 py-2 text-xs" style={{ backgroundColor: widgetSettings.agentBubbleColor, color: widgetSettings.textColor }}>{activeAssistant.welcomeMessage || "Hallo! Wie kann ich helfen?"}</div><div className="ml-auto max-w-[74%] rounded-xl rounded-br-sm px-3 py-2 text-xs text-white" style={{ backgroundColor: widgetSettings.primaryColor }}>Ich brauche Hilfe.</div></div><div className="flex gap-2 border-t p-2" style={{ backgroundColor: widgetSettings.surfaceColor }}><div className="flex-1 rounded border border-slate-300 px-2 py-2 text-[10px] text-slate-400">{widgetSettings.inputPlaceholder}</div><div className="rounded px-2 py-2 text-[10px] font-semibold text-white" style={{ backgroundColor: widgetSettings.primaryColor }}>{widgetSettings.sendLabel}</div></div></div><div className="flex items-center justify-center text-xl text-white shadow-lg" style={{ width: Number(widgetSettings.launcherSize), height: Number(widgetSettings.launcherSize), borderRadius: Number(widgetSettings.launcherRadius), backgroundColor: widgetSettings.primaryColor }}>{widgetSettings.launcherIcon || "💬"}</div></div></div></div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-3">
              <label className="block text-xs font-semibold text-slate-300 uppercase">Integration Snippet</label>
              <pre className="bg-slate-950 p-4 rounded-lg border border-slate-800 text-xs font-mono text-blue-300 overflow-x-auto">
                {`<script\n  src="${API_BASE_URL.replace("/api/v1", "")}/public/widget.js"\n  data-assistant-id="${activeAssistant.id}"\n  data-widget-key="${activeAssistant.widgetApiKey}"\n  data-api-base="${API_BASE_URL.replace("/api/v1", "")}"\n></script>`}
              </pre>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-3">
              <div className="flex items-center justify-between gap-4"><div><label className="block text-xs font-semibold text-slate-300 uppercase">Public Widget Integration Key</label><p className="text-xs text-slate-500 mt-1">Rotate immediately if it is exposed. Rotation invalidates existing embeds.</p></div><button onClick={handleRotateWidgetKey} className="px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> Rotate</button></div>
              <input readOnly value={activeAssistant.widgetApiKey || ""} className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs font-mono text-emerald-400" />
            </div>

            <form onSubmit={handleSaveAssistantSettings} className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-4">
              <div><label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Allowed Website Origins</label><textarea value={(activeAssistant.widgetAllowedOrigins || []).join("\n")} onChange={(e) => setActiveAssistant({ ...activeAssistant, widgetAllowedOrigins: e.target.value.split("\n").map((origin) => origin.trim()).filter(Boolean) })} placeholder={"https://www.example.com\nhttps://shop.example.com"} className="w-full h-24 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-slate-200" /><p className="text-xs text-slate-500 mt-1">One exact origin per line. Leave empty only for server-to-server or development integrations.</p></div>
              <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={Boolean(activeAssistant.chatPageEnabled)} onChange={(e) => setActiveAssistant({ ...activeAssistant, chatPageEnabled: e.target.checked })} /> Enable a hosted chatbot page</label>
              {activeAssistant.chatPageEnabled && <div><label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Hosted Chat Page URL</label><input readOnly value={`${API_BASE_URL}/widget/page/${activeAssistant.id}?widgetKey=${activeAssistant.widgetApiKey}`} className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs font-mono text-blue-300" /></div>}
              <button type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded">Save Widget Access Settings</button>
            </form>
          </div>
        )}

        {/* TAB 8: SETTINGS */}
        {activeTab === "settings" && activeOrg && (
          <div className="space-y-6 max-w-4xl mx-auto">
            <div>
              <h1 className="text-xl font-bold text-white">Organization Settings</h1>
              <p className="text-xs text-slate-400">Manage tenant identity and API keys</p>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl space-y-4">
              <div>
                <span className="text-xs font-semibold text-slate-400 uppercase">Organization API Key</span>
                <div className="flex gap-2 mt-1">
                  <input
                    type="text"
                    readOnly
                    className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs font-mono text-amber-400"
                    value={activeOrg.apiKey || "sk_live_..."}
                  />
                  <button
                    onClick={handleRegenerateApiKey}
                    className="px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded flex items-center gap-1"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Regenerate
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
