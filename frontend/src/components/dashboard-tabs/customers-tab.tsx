"use client";

import { memo } from "react";

function CustomersTab({ customers }: { customers: any[] }) {
  return <div className="space-y-6 max-w-6xl mx-auto">
    <div><h1 className="text-xl font-bold text-white">Customer Directory</h1><p className="text-xs text-slate-400">Customers are created automatically when they start a widget session.</p></div>
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
      <table className="w-full text-left text-xs"><thead className="bg-slate-800/80 text-slate-400"><tr><th className="p-3">Customer</th><th className="p-3">Email</th><th className="p-3">External ID</th><th className="p-3">Joined</th></tr></thead>
        <tbody className="divide-y divide-slate-800">{customers.length ? customers.map((customer) => <tr key={customer.id} className="text-slate-300"><td className="p-3 font-medium text-white">{customer.name || "Website visitor"}</td><td className="p-3">{customer.email || "—"}</td><td className="p-3 font-mono text-slate-500">{customer.externalId || "—"}</td><td className="p-3 text-slate-500">{new Date(customer.createdAt).toLocaleDateString()}</td></tr>) : <tr><td colSpan={4} className="p-8 text-center text-slate-500">No customers yet. Embed the widget or create a test session to see customers here.</td></tr>}</tbody>
      </table>
    </div>
  </div>;
}

export default memo(CustomersTab);
