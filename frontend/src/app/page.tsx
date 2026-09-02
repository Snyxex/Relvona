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

export default function DashboardPage() {
  const [auth, setAuth] = useState<{ user: any; organizations: any[]; token: string } | null>(null);
  const [activeOrg, setActiveOrg] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<
    "overview" | "conversations" | "tickets" | "knowledge" | "websites" | "assistant" | "agents" | "customers" | "analytics" | "widget" | "settings"
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
              { id: "widget", label: "Embeddable Widget", icon: Code },
              { id: "settings", label: "Organization Settings", icon: Settings },
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
            <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center font-bold text-xs">
              {auth.user.name.charAt(0)}
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
            <div>
              <h1 className="text-xl font-bold text-white">Analytics & Insights</h1>
              <p className="text-xs text-slate-400">Measure support workload, AI resolution, handoffs, and knowledge-base coverage.</p>
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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                <h2 className="text-sm font-semibold text-white">Conversation states</h2>
                <div className="mt-4 space-y-3">
                  {Object.entries(overviewMetrics?.stateBreakdown || {}).map(([state, count]) => {
                    const total = overviewMetrics?.totalConversations || 1;
                    const width = Math.max(3, (Number(count) / total) * 100);
                    return <div key={state}><div className="mb-1 flex justify-between text-xs text-slate-400"><span>{state.replaceAll("_", " ")}</span><span>{String(count)}</span></div><div className="h-2 overflow-hidden rounded bg-slate-800"><div className="h-full rounded bg-blue-500" style={{ width: `${width}%` }} /></div></div>;
                  })}
                </div>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                <h2 className="text-sm font-semibold text-white">Detected languages</h2>
                <div className="mt-4 space-y-3">
                  {overviewMetrics?.languageBreakdown?.length ? overviewMetrics.languageBreakdown.map((entry: any) => <div key={entry.language} className="flex justify-between rounded bg-slate-800/60 px-3 py-2 text-xs"><span className="uppercase text-slate-300">{entry.language}</span><span className="font-semibold text-white">{entry.count}</span></div>) : <p className="text-xs text-slate-500">No conversation data yet.</p>}
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="text-sm font-semibold text-white">Questions needing attention</h2>
              <div className="mt-3 space-y-2">{overviewMetrics?.unansweredQuestions?.length ? overviewMetrics.unansweredQuestions.map((question: any) => <div key={question.id} className="rounded bg-amber-950/30 px-3 py-2 text-xs text-amber-200">{question.question}</div>) : <p className="text-xs text-slate-500">No unanswered questions or pending handoffs.</p>}</div>
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
            <h1 className="text-xl font-bold text-white">Customer Support Tickets</h1>

            <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
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
                  {ticketsList.map((tk) => (
                    <tr key={tk.id} className="hover:bg-slate-800/40">
                      <td className="p-3 font-mono font-bold text-blue-400">#{tk.ticketNumber}</td>
                      <td className="p-3 font-medium text-slate-200">{tk.subject}</td>
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
              <p className="text-xs text-slate-400">Customize model selection, temperature, system prompts, and handoff triggers</p>
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
              <h1 className="text-xl font-bold text-white">Embeddable Customer Chat Widget</h1>
              <p className="text-xs text-slate-400">Use this dedicated public integration key for customer websites. It is not your Organization API Key.</p>
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
