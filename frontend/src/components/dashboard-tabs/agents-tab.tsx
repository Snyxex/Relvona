"use client";

import { memo } from "react";

function AgentsTab({ agents }: { agents: any[] }) {
  return <div className="space-y-6 max-w-5xl mx-auto">
    <div><h1 className="text-xl font-bold text-white">Support Agents</h1><p className="text-xs text-slate-400">Team members who can handle escalated customer conversations.</p></div>
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
      <table className="w-full text-left text-xs"><thead className="bg-slate-800/80 text-slate-400"><tr><th className="p-3">Agent</th><th className="p-3">Email</th><th className="p-3">Role</th><th className="p-3">Access</th></tr></thead>
        <tbody className="divide-y divide-slate-800">{agents.length ? agents.map((agent) => <tr key={agent.id} className="text-slate-300"><td className="p-3 font-medium text-white">{agent.name}</td><td className="p-3">{agent.email}</td><td className="p-3 uppercase">{agent.role}</td><td className="p-3"><span className="rounded bg-emerald-950 px-2 py-1 text-[10px] text-emerald-300">ACTIVE</span></td></tr>) : <tr><td colSpan={4} className="p-8 text-center text-slate-500">No support agents have been added to this organization.</td></tr>}</tbody>
      </table>
    </div>
    <p className="rounded-lg border border-blue-900 bg-blue-950/30 p-3 text-xs text-blue-200">Agents can claim and reply to conversations from the Conversations Inbox. Add users to the organization with an <code>agent</code>, <code>admin</code>, or <code>owner</code> membership role.</p>
  </div>;
}

export default memo(AgentsTab);
