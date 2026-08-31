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
  AlertCircle
} from "lucide-react";
import axios from "axios";

const API_BASE = "http://localhost:5000/api";

export default function App() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "knowledge" | "tickets" | "widget_demo" | "settings">("dashboard");
  const [workspace, setWorkspace] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [knowledgeList, setKnowledgeList] = useState<any[]>([]);
  const [ticketsList, setTicketsList] = useState<any[]>([]);

  // Modals / Inputs
  const [faqTitle, setFaqTitle] = useState("");
  const [faqContent, setFaqContent] = useState("");
  const [crawlUrl, setCrawlUrl] = useState("");
  const [crawlTitle, setCrawlTitle] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  // Ticket & Chat detail
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [ticketMessages, setTicketMessages] = useState<any[]>([]);
  const [agentReplyInput, setAgentReplyInput] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState("");

  // Demo Widget State
  const [demoTicket, setDemoTicket] = useState<any>(null);
  const [demoChatMsgs, setDemoChatMsgs] = useState<any[]>([]);
  const [demoInput, setDemoInput] = useState("");
  const [isHandoffRequested, setIsHandoffRequested] = useState(false);

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    try {
      const wsRes = await axios.get(`${API_BASE}/workspace`);
      setWorkspace(wsRes.data);

      const [anRes, knRes, tkRes] = await Promise.all([
        axios.get(`${API_BASE}/analytics/${wsRes.data.id}`),
        axios.get(`${API_BASE}/knowledge/${wsRes.data.id}`),
        axios.get(`${API_BASE}/tickets/${wsRes.data.id}`),
      ]);
      setAnalytics(anRes.data);
      setKnowledgeList(knRes.data);
      setTicketsList(tkRes.data);
    } catch (err) {
      console.error("Failed to load initial data", err);
    }
  };

  const handleIngestFaq = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!faqTitle || !faqContent || !workspace) return;
    setLoading(true);
    try {
      await axios.post(`${API_BASE}/knowledge/faq`, {
        workspaceId: workspace.id,
        title: faqTitle,
        content: faqContent,
      });
      setFaqTitle("");
      setFaqContent("");
      fetchInitialData();
    } catch (err) {
      alert("Failed to add FAQ");
    } finally {
      setLoading(false);
    }
  };

  const handleCrawl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!crawlUrl || !workspace) return;
    setLoading(true);
    try {
      await axios.post(`${API_BASE}/knowledge/crawl`, {
        workspaceId: workspace.id,
        url: crawlUrl,
        title: crawlTitle || crawlUrl,
      });
      setCrawlUrl("");
      setCrawlTitle("");
      fetchInitialData();
    } catch (err) {
      alert("Crawl failed or invalid URL");
    } finally {
      setLoading(false);
    }
  };

  const handlePdfUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !workspace) return;
    setLoading(true);
    const formData = new FormData();
    formData.append("workspaceId", workspace.id);
    formData.append("file", selectedFile);
    try {
      await axios.post(`${API_BASE}/knowledge/pdf`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setSelectedFile(null);
      fetchInitialData();
    } catch (err) {
      alert("PDF upload failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteKnowledge = async (id: string) => {
    try {
      await axios.delete(`${API_BASE}/knowledge/${id}`);
      fetchInitialData();
    } catch (err) {
      alert("Failed to delete knowledge item");
    }
  };

  // Agent Operations
  const selectTicket = async (ticket: any) => {
    setSelectedTicket(ticket);
    setAiSuggestion("");
    try {
      const res = await axios.get(`${API_BASE}/tickets/${ticket.id}/messages`);
      setTicketMessages(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAgentReply = async () => {
    if (!agentReplyInput || !selectedTicket) return;
    try {
      const res = await axios.post(`${API_BASE}/tickets/${selectedTicket.id}/reply`, {
        senderName: "Agent Support",
        content: agentReplyInput,
      });
      setTicketMessages([...ticketMessages, res.data]);
      setAgentReplyInput("");
      fetchInitialData();
    } catch (err) {
      alert("Failed to send reply");
    }
  };

  const getAiSuggestedReply = async () => {
    if (!selectedTicket) return;
    try {
      const res = await axios.post(`${API_BASE}/tickets/${selectedTicket.id}/suggest-reply`);
      setAiSuggestion(res.data.suggestedReply);
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateTicketStatus = async (status: string) => {
    if (!selectedTicket) return;
    try {
      await axios.put(`${API_BASE}/tickets/${selectedTicket.id}/status`, { status });
      setSelectedTicket({ ...selectedTicket, status });
      fetchInitialData();
    } catch (err) {
      alert("Failed to update status");
    }
  };

  // Demo Widget
  const startDemoChat = async () => {
    if (!workspace) return;
    try {
      const res = await axios.post(`${API_BASE}/chat/start`, {
        workspaceId: workspace.id,
        customerName: "Alex Rivera",
        customerEmail: "alex@example.com",
        subject: "Product Question",
      });
      setDemoTicket(res.data);
      setDemoChatMsgs([
        {
          senderType: "ai",
          senderName: "AI Assistant",
          content: "Hello Alex! How can I assist you with our services today?",
        },
      ]);
      setIsHandoffRequested(false);
    } catch (err) {
      console.error(err);
    }
  };

  const sendDemoMessage = async () => {
    if (!demoInput || !demoTicket) return;
    const userMsg = demoInput;
    setDemoInput("");
    setDemoChatMsgs((prev) => [...prev, { senderType: "customer", senderName: "Alex", content: userMsg }]);

    try {
      const res = await axios.post(`${API_BASE}/chat/message`, {
        ticketId: demoTicket.id,
        message: userMsg,
      });
      if (res.data.handOff) {
        setIsHandoffRequested(true);
        setDemoChatMsgs((prev) => [
          ...prev,
          {
            senderType: "ai",
            senderName: "System",
            content: "You have been placed in the Human Agent queue. An agent will respond shortly.",
          },
        ]);
      } else {
        setDemoChatMsgs((prev) => [
          ...prev,
          {
            senderType: "ai",
            senderName: "AI Assistant",
            content: res.data.aiReply,
          },
        ]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const triggerHandoff = async () => {
    if (!demoTicket) return;
    try {
      await axios.post(`${API_BASE}/chat/handoff`, { ticketId: demoTicket.id });
      setIsHandoffRequested(true);
      setDemoChatMsgs((prev) => [
        ...prev,
        {
          senderType: "ai",
          senderName: "System",
          content: "Human agent handoff requested. Standby for live agent connection...",
        },
      ]);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex h-screen bg-slate-900 text-slate-100 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col justify-between">
        <div>
          <div className="p-5 flex items-center space-x-3 border-b border-slate-800">
            <div className="p-2 bg-indigo-600 rounded-lg">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight text-indigo-400">OmniSupport AI</h1>
              <p className="text-xs text-slate-400">Customer Assistant Platform</p>
            </div>
          </div>

          <nav className="p-3 space-y-1">
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition ${
                activeTab === "dashboard" ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30" : "text-slate-400 hover:bg-slate-800"
              }`}
            >
              <BarChart3 className="w-5 h-5" />
              <span>Dashboard & Analytics</span>
            </button>
            <button
              onClick={() => setActiveTab("knowledge")}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition ${
                activeTab === "knowledge" ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30" : "text-slate-400 hover:bg-slate-800"
              }`}
            >
              <FileText className="w-5 h-5" />
              <span>Knowledge Base</span>
            </button>
            <button
              onClick={() => setActiveTab("tickets")}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition ${
                activeTab === "tickets" ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30" : "text-slate-400 hover:bg-slate-800"
              }`}
            >
              <Ticket className="w-5 h-5" />
              <span>Tickets & Live Handoff</span>
            </button>
            <button
              onClick={() => setActiveTab("widget_demo")}
              className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition ${
                activeTab === "widget_demo" ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30" : "text-slate-400 hover:bg-slate-800"
              }`}
            >
              <MessageSquare className="w-5 h-5" />
              <span>Live Chat Simulator</span>
            </button>
          </nav>
        </div>

        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center space-x-3 text-xs text-slate-400">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span>Status: Engine Active</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto bg-slate-900">
        {/* Top bar */}
        <header className="px-8 py-4 bg-slate-950/50 border-b border-slate-800 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold capitalize text-white">{activeTab.replace("_", " ")}</h2>
            <p className="text-xs text-slate-400">Workspace: {workspace?.name || "Loading..."}</p>
          </div>
          <div className="flex items-center space-x-3">
            <span className="bg-indigo-900/50 text-indigo-300 text-xs px-3 py-1 rounded-full border border-indigo-700">
              AI Engine: {workspace?.aiModel || "OpenAI / Nvidia"}
            </span>
          </div>
        </header>

        <div className="p-8">
          {/* TAB 1: DASHBOARD & ANALYTICS */}
          {activeTab === "dashboard" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="p-5 bg-slate-800/60 border border-slate-700 rounded-xl">
                  <p className="text-slate-400 text-xs font-semibold">Total Tickets</p>
                  <h3 className="text-3xl font-extrabold text-white mt-2">{analytics?.totalTickets || 0}</h3>
                  <p className="text-emerald-400 text-xs mt-2 flex items-center">
                    <CheckCircle className="w-3 h-3 mr-1" /> 24/7 AI Resolution
                  </p>
                </div>

                <div className="p-5 bg-slate-800/60 border border-slate-700 rounded-xl">
                  <p className="text-slate-400 text-xs font-semibold">Knowledge Sources</p>
                  <h3 className="text-3xl font-extrabold text-white mt-2">{analytics?.knowledgeSourcesCount || 0}</h3>
                  <p className="text-indigo-400 text-xs mt-2">FAQs, PDFs, Crawls</p>
                </div>

                <div className="p-5 bg-slate-800/60 border border-slate-700 rounded-xl">
                  <p className="text-slate-400 text-xs font-semibold">Avg AI Response Time</p>
                  <h3 className="text-3xl font-extrabold text-white mt-2">{analytics?.avgResponseTime || "1.2s"}</h3>
                  <p className="text-slate-400 text-xs mt-2">pgvector RAG Lookup</p>
                </div>

                <div className="p-5 bg-slate-800/60 border border-slate-700 rounded-xl">
                  <p className="text-slate-400 text-xs font-semibold">AI Deflection Rate</p>
                  <h3 className="text-3xl font-extrabold text-emerald-400 mt-2">{analytics?.resolutionRate || "94%"}</h3>
                  <p className="text-slate-400 text-xs mt-2">Automated query resolution</p>
                </div>
              </div>

              {/* Multi Language & Intelligence overview */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-6 bg-slate-800/60 border border-slate-700 rounded-xl">
                  <h3 className="font-bold text-lg text-white mb-4 flex items-center">
                    <Globe className="w-5 h-5 text-indigo-400 mr-2" /> Multi-Language Support
                  </h3>
                  <p className="text-slate-300 text-sm mb-4">
                    The platform automatically detects customer locale and responds seamlessly in English, Spanish, French, German, Japanese, and more.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {analytics?.supportedLanguages?.map((lang: string) => (
                      <span key={lang} className="px-3 py-1 bg-slate-700/60 text-slate-300 rounded-lg text-xs border border-slate-600">
                        {lang}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="p-6 bg-slate-800/60 border border-slate-700 rounded-xl">
                  <h3 className="font-bold text-lg text-white mb-4 flex items-center">
                    <Sparkles className="w-5 h-5 text-amber-400 mr-2" /> Human Agent Handoff & AI Assistance
                  </h3>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    When complex inquiries require human intervention, the system instantly escalates tickets to the agent dashboard, auto-generating **AI Suggested Replies** to maximize support agent efficiency.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: KNOWLEDGE BASE */}
          {activeTab === "knowledge" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-1 space-y-6">
                {/* Upload FAQ */}
                <div className="p-6 bg-slate-800/60 border border-slate-700 rounded-xl">
                  <h3 className="font-bold text-white mb-4 flex items-center">
                    <HelpCircle className="w-5 h-5 text-indigo-400 mr-2" /> Add FAQ / Article
                  </h3>
                  <form onSubmit={handleIngestFaq} className="space-y-4">
                    <div>
                      <label className="text-xs text-slate-400 font-medium">Question / Title</label>
                      <input
                        type="text"
                        placeholder="e.g. What is your refund policy?"
                        value={faqTitle}
                        onChange={(e) => setFaqTitle(e.target.value)}
                        className="w-full mt-1 p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 font-medium">Answer Content</label>
                      <textarea
                        placeholder="e.g. We offer a 30-day full refund policy..."
                        value={faqContent}
                        onChange={(e) => setFaqContent(e.target.value)}
                        className="w-full mt-1 p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500 h-24"
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium text-sm transition"
                    >
                      {loading ? "Ingesting..." : "Save FAQ Chunk"}
                    </button>
                  </form>
                </div>

                {/* Crawl Website */}
                <div className="p-6 bg-slate-800/60 border border-slate-700 rounded-xl">
                  <h3 className="font-bold text-white mb-4 flex items-center">
                    <Globe className="w-5 h-5 text-emerald-400 mr-2" /> Crawl Website
                  </h3>
                  <form onSubmit={handleCrawl} className="space-y-4">
                    <div>
                      <label className="text-xs text-slate-400 font-medium">Website Name</label>
                      <input
                        type="text"
                        placeholder="e.g. Documentation Site"
                        value={crawlTitle}
                        onChange={(e) => setCrawlTitle(e.target.value)}
                        className="w-full mt-1 p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 font-medium">Target URL</label>
                      <input
                        type="url"
                        placeholder="https://example.com/docs"
                        value={crawlUrl}
                        onChange={(e) => setCrawlUrl(e.target.value)}
                        className="w-full mt-1 p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500"
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium text-sm transition"
                    >
                      {loading ? "Crawling & Vectorizing..." : "Start Web Crawl"}
                    </button>
                  </form>
                </div>

                {/* Upload PDF */}
                <div className="p-6 bg-slate-800/60 border border-slate-700 rounded-xl">
                  <h3 className="font-bold text-white mb-4 flex items-center">
                    <Upload className="w-5 h-5 text-amber-400 mr-2" /> Upload PDF Document
                  </h3>
                  <form onSubmit={handlePdfUpload} className="space-y-4">
                    <div>
                      <input
                        type="file"
                        accept="application/pdf"
                        onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                        className="w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-slate-700 file:text-white hover:file:bg-slate-600"
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-medium text-sm transition"
                    >
                      {loading ? "Parsing PDF..." : "Upload & Extract Vectors"}
                    </button>
                  </form>
                </div>
              </div>

              {/* Ingested Sources Table */}
              <div className="lg:col-span-2 p-6 bg-slate-800/60 border border-slate-700 rounded-xl">
                <h3 className="font-bold text-white mb-4">Ingested Knowledge Base Vector Index</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-slate-300">
                    <thead className="bg-slate-900/60 text-slate-400 uppercase text-xs">
                      <tr>
                        <th className="p-3">Title / Source</th>
                        <th className="p-3">Type</th>
                        <th className="p-3">Vector Chunks</th>
                        <th className="p-3">Status</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700">
                      {knowledgeList.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-6 text-center text-slate-500">
                            No knowledge sources added yet. Add a FAQ, PDF, or website URL above.
                          </td>
                        </tr>
                      ) : (
                        knowledgeList.map((item) => (
                          <tr key={item.id} className="hover:bg-slate-800/40">
                            <td className="p-3 font-medium text-white">{item.title}</td>
                            <td className="p-3">
                              <span className="px-2 py-1 bg-slate-700 rounded text-xs uppercase font-semibold">
                                {item.type}
                              </span>
                            </td>
                            <td className="p-3">{item.chunkCount || 0} vectors</td>
                            <td className="p-3">
                              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-900/60 text-emerald-300 border border-emerald-700">
                                {item.status}
                              </span>
                            </td>
                            <td className="p-3 text-right">
                              <button
                                onClick={() => handleDeleteKnowledge(item.id)}
                                className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-slate-700"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: TICKETS & HUMAN AGENT HANDOFF */}
          {activeTab === "tickets" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Ticket List */}
              <div className="lg:col-span-1 p-6 bg-slate-800/60 border border-slate-700 rounded-xl space-y-4">
                <h3 className="font-bold text-white">Support Tickets Queue</h3>
                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                  {ticketsList.map((tk) => (
                    <div
                      key={tk.id}
                      onClick={() => selectTicket(tk)}
                      className={`p-4 rounded-xl border cursor-pointer transition ${
                        selectedTicket?.id === tk.id
                          ? "bg-indigo-900/40 border-indigo-500"
                          : "bg-slate-900/60 border-slate-700 hover:border-slate-600"
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <span className="font-semibold text-white text-sm">{tk.customerName}</span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${
                            tk.handOffRequested ? "bg-amber-900/70 text-amber-300 border border-amber-600" : "bg-slate-700 text-slate-300"
                          }`}
                        >
                          {tk.handOffRequested ? "Handoff Needed" : tk.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1 truncate">{tk.subject}</p>
                      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                        <span>Sentiment: {tk.sentiment}</span>
                        <span>{new Date(tk.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Conversation Detail & AI Suggested Replies */}
              <div className="lg:col-span-2 p-6 bg-slate-800/60 border border-slate-700 rounded-xl flex flex-col justify-between h-[650px]">
                {selectedTicket ? (
                  <>
                    <div>
                      <div className="pb-4 border-b border-slate-700 flex justify-between items-center">
                        <div>
                          <h3 className="font-bold text-white">{selectedTicket.subject}</h3>
                          <p className="text-xs text-slate-400">Customer: {selectedTicket.customerEmail}</p>
                        </div>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => handleUpdateTicketStatus("resolved")}
                            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold"
                          >
                            Mark Resolved
                          </button>
                        </div>
                      </div>

                      {/* Chat Messages */}
                      <div className="my-4 space-y-3 max-h-[350px] overflow-y-auto pr-2">
                        {ticketMessages.map((m, idx) => (
                          <div
                            key={idx}
                            className={`p-3.5 rounded-xl max-w-[80%] text-sm ${
                              m.senderType === "customer"
                                ? "bg-slate-700 text-white self-start"
                                : m.senderType === "ai"
                                ? "bg-indigo-950/80 border border-indigo-800 text-indigo-100 ml-auto"
                                : "bg-emerald-950/80 border border-emerald-800 text-emerald-100 ml-auto"
                            }`}
                          >
                            <div className="flex justify-between items-center text-xs font-semibold mb-1 opacity-70">
                              <span>{m.senderName}</span>
                              <span>{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                            </div>
                            <p className="leading-relaxed">{m.content}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Agent Controls & AI Suggestions */}
                    <div className="pt-4 border-t border-slate-700 space-y-3">
                      {/* AI Suggested Reply Box */}
                      <div className="p-3 bg-indigo-950/40 border border-indigo-800/60 rounded-xl flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Sparkles className="w-4 h-4 text-amber-400" />
                          <span className="text-xs text-indigo-300 font-semibold">AI Copilot Suggested Reply:</span>
                        </div>
                        <button
                          onClick={getAiSuggestedReply}
                          className="px-2.5 py-1 bg-indigo-700 hover:bg-indigo-600 text-white rounded text-xs"
                        >
                          Generate AI Suggestion
                        </button>
                      </div>

                      {aiSuggestion && (
                        <div className="p-3 bg-slate-900 border border-indigo-700/50 rounded-lg text-xs text-slate-300">
                          <p className="font-mono">{aiSuggestion}</p>
                          <button
                            onClick={() => setAgentReplyInput(aiSuggestion)}
                            className="mt-2 text-indigo-400 font-medium hover:underline"
                          >
                            Use this response
                          </button>
                        </div>
                      )}

                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          placeholder="Type agent response..."
                          value={agentReplyInput}
                          onChange={(e) => setAgentReplyInput(e.target.value)}
                          className="flex-1 p-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
                        />
                        <button
                          onClick={handleAgentReply}
                          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold flex items-center"
                        >
                          <Send className="w-4 h-4 mr-1" /> Reply
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-slate-500">
                    <Ticket className="w-12 h-12 mb-2 stroke-1" />
                    <p>Select a ticket from the queue to view details & respond.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: LIVE CHAT SIMULATOR */}
          {activeTab === "widget_demo" && (
            <div className="max-w-md mx-auto bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[600px]">
              <div className="p-4 bg-indigo-600 flex items-center justify-between text-white">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-white/20 rounded-full">
                    <Bot className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-sm">24/7 AI Support Bot</h4>
                    <p className="text-xs text-indigo-200">Powered by RAG & Vector Search</p>
                  </div>
                </div>
                {!demoTicket && (
                  <button
                    onClick={startDemoChat}
                    className="px-3 py-1 bg-white text-indigo-600 font-semibold text-xs rounded-lg shadow hover:bg-indigo-50"
                  >
                    Start Chat
                  </button>
                )}
              </div>

              <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-900">
                {!demoTicket ? (
                  <div className="flex flex-col items-center justify-center h-full text-center p-6 text-slate-400 space-y-3">
                    <Bot className="w-10 h-10 text-indigo-400" />
                    <p className="text-sm">Click "Start Chat" to launch the simulated customer widget.</p>
                  </div>
                ) : (
                  demoChatMsgs.map((msg, i) => (
                    <div
                      key={i}
                      className={`p-3 rounded-xl text-sm max-w-[85%] ${
                        msg.senderType === "customer"
                          ? "bg-indigo-600 text-white ml-auto"
                          : "bg-slate-800 text-slate-200 border border-slate-700"
                      }`}
                    >
                      <p className="text-xs text-slate-400 mb-1">{msg.senderName}</p>
                      <p>{msg.content}</p>
                    </div>
                  ))
                )}
              </div>

              {demoTicket && (
                <div className="p-3 bg-slate-950 border-t border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Multi-Language Auto-Detect</span>
                    <button
                      onClick={triggerHandoff}
                      className="text-amber-400 hover:underline flex items-center"
                    >
                      <UserCheck className="w-3 h-3 mr-1" /> Request Human Agent
                    </button>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      placeholder="Ask AI support..."
                      value={demoInput}
                      onChange={(e) => setDemoInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && sendDemoMessage()}
                      className="flex-1 p-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      onClick={sendDemoMessage}
                      className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
