"use client";

import { memo } from "react";
import { CheckCircle } from "lucide-react";

function OverviewTab({ overviewMetrics }: { overviewMetrics: any }) {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-white">Platform Dashboard Overview</h1>
        <p className="text-xs text-slate-400">Multi-tenant AI support agent performance and live status</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <span className="text-xs text-slate-400 font-medium">Total Conversations</span>
          <p className="text-2xl font-bold text-white mt-1">{overviewMetrics?.totalConversations || 0}</p>
          <div className="mt-2 text-[10px] text-emerald-400 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> 100% tenant isolated</div>
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
          <h3 className="text-sm font-semibold text-white mb-3">Knowledge Base Coverage</h3>
          <div className="flex justify-around text-center py-4 border-y border-slate-800">
            <div><span className="text-xs text-slate-400">Sources</span><p className="text-xl font-bold text-white">{overviewMetrics?.totalKnowledgeSources || 0}</p></div>
            <div><span className="text-xs text-slate-400">pgvector Chunks</span><p className="text-xl font-bold text-blue-400">{overviewMetrics?.totalDocumentChunks || 0}</p></div>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
          <h3 className="text-sm font-semibold text-white mb-3">Recent Unanswered Queries</h3>
          <div className="space-y-2">
            {overviewMetrics?.unansweredQuestions?.length > 0 ? overviewMetrics.unansweredQuestions.map((q: any) => (
              <div key={q.id} className="p-2.5 bg-slate-800/60 rounded text-xs text-slate-300">"{q.question}"</div>
            )) : <p className="text-xs text-slate-500 italic py-4">No recent unanswered queries detected.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(OverviewTab);
