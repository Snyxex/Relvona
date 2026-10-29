"use client";

import { memo, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, CheckCircle2,
  Clock3, Headphones, MessageSquareText, Search, Sparkles, Star, Ticket, Users,
} from "lucide-react";
import { api } from "@/lib/api";

type Metric = { tickets: number; appointments: number; conversations: number; upcomingAppointments: number;
  averageFirstResponseMinutes: number | null; satisfactionRate: number | null; feedbackCount: number;
  previous: { tickets: number; appointments: number; conversations: number } };
type TicketRow = { id: string; number: number; subject: string; status: string; createdAt: string; customerName: string | null };
type Booking = { id: string; title: string; startsAt: string; endsAt: string; guestName: string | null; meetingUrl: string | null };
type DashboardReport = {
  generatedAt: string; days: number; kpis: Metric;
  volume: { day: string; tickets: number; conversations: number }[];
  categories: { name: string; total: number; share: number }[]; categoriesTotal: number;
  status: { status: string; total: number; share: number }[]; statusTotal: number;
  recentTickets: TicketRow[]; upcomingAppointments: Booking[];
  activity: { id: string; eventType: string; createdAt: string }[];
};
type Props = {
  organizationId?: string;
  user?: { name?: string; avatarUrl?: string | null };
  onNavigate?: (tab: "overview" | "tickets" | "conversations" | "analytics" | "customers") => void;
  onOpenTicket?: (ticket: TicketRow) => void;
  canManage?: boolean;
};

const statusNames: Record<string, string> = {
  open: "Offen", in_progress: "In Bearbeitung", pending: "Wartend", resolved: "Gelöst", closed: "Geschlossen",
};
const statusColors: Record<string,string> = {
  open: "#5278f6", in_progress: "#9162f2", pending: "#4fc0eb", resolved: "#36bea9", closed: "#b9c5d9",
};
const categoryColors = ["#5179fb", "#9167f4", "#50bbed", "#38bfad", "#f7b654", "#91a3c1"];
const formatNumber = (num: number) => new Intl.NumberFormat("de-DE").format(num);
const relative = (date: string) => {
  const diff = Math.max(0, Date.now() - new Date(date).getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "Gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  if (minutes < 1440) return `vor ${Math.floor(minutes / 60)} Std.`;
  return new Date(date).toLocaleDateString("de-DE");
};
const responseTime = (minutes: number | null) => minutes == null ? "—" :
  minutes < 60 ? `${Math.round(minutes)} Min.` : `${Math.floor(minutes / 60)} Std. ${Math.round(minutes % 60)} Min.`;
function delta(current: number, previous: number) {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(1, ...values), min = Math.min(0, ...values);
  const positions = values.map((value, index) => {
    const x = 4 + index * 88 / Math.max(values.length - 1, 1);
    const y = 35 - ((value - min) / (max - min || 1)) * 28;
    return `${x},${y}`;
  }).join(" ");
  return <svg viewBox="0 0 100 40" width="86" height="40" aria-hidden="true" focusable="false" className="rv-sparkline">
    <polyline points={positions} stroke={color} strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
  </svg>;
}
function MetricCard({ label, value, detail, icon: Icon, tone, change, spark }:{
  label: string; value: string; detail: string; icon: typeof Ticket; tone: string; change?: number | null; spark?: number[];
}) {
  return <article className="rv-metric-card">
    <div className="rv-metric-top"><span className="rv-metric-icon" style={{ color: tone, background: `${tone}14` }}><Icon size={21}/></span><span className="rv-metric-label">{label}</span></div>
    <div className="rv-metric-bottom"><div className="rv-metric-copy"><strong>{value}</strong>
      <span className="rv-metric-detail">
        {change != null && <span className={change >= 0 ? "rv-change-up" : "rv-change-down"}>{change >= 0 ? <ArrowUpRight size={13}/> : <ArrowDownRight size={13}/>} {Math.abs(change)}% · </span>}
        {detail}
      </span>
    </div>{spark && spark.length > 1 && <Sparkline values={spark} color={tone}/>}</div>
  </article>;
}
function VolumeChart({ points }:{ points: DashboardReport["volume"] }) {
  const w = 720, h = 224, left = 36, right = 13, top = 19, bottom = 34;
  const peak = Math.max(1,...points.flatMap(p=>[p.tickets,p.conversations]));
  const scale = Math.max(5, Math.ceil(peak / 5) * 5);
  const line = (field:"tickets"|"conversations") => points.map((point,index)=>{
    const x=left + index*(w-left-right)/Math.max(points.length-1,1);
    const y=top+(h-top-bottom)*(1-point[field]/scale);
    return [x,y] as const;
  });
  const makePath=(field:"tickets"|"conversations") => line(field).map((p,i)=>`${i===0?"M":"L"} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
  const fill=(field:"tickets"|"conversations")=>`${makePath(field)} L ${w-right} ${h-bottom} L ${left} ${h-bottom} Z`;
  return <svg className="rv-volume-chart" viewBox={`0 0 ${w} ${h}`} role="img"
    aria-label="Linien-Diagramm der Tickets und AI-Unterhaltungen im ausgewählten Zeitraum">
    <defs><linearGradient id="rv-ticket-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#4978ff" stopOpacity=".21"/><stop offset="100%" stopColor="#4978ff" stopOpacity="0"/></linearGradient>
      <linearGradient id="rv-conv-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#9369f4" stopOpacity=".15"/><stop offset="100%" stopColor="#9369f4" stopOpacity="0"/></linearGradient></defs>
    {[0,.25,.5,.75,1].map(f=>{const y=top+(h-top-bottom)*f;return <g key={f}><line x1={left} x2={w-right} y1={y} y2={y} stroke="#e9edf6" strokeWidth="1"/><text x={left-10} y={y+3} textAnchor="end" fontSize="10" fill="#8b97ac">{Math.round(scale*(1-f))}</text></g>;})}
    <path d={fill("conversations")} fill="url(#rv-conv-fill)"/>
    <path d={fill("tickets")} fill="url(#rv-ticket-fill)"/>
    <path d={makePath("conversations")} stroke="#9671f6" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    <path d={makePath("tickets")} stroke="#4479f8" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    {points.filter((_,i)=>i===0||i===points.length-1||i%Math.max(1,Math.round(points.length/5))===0).map(p=><text key={p.day} x={left+points.indexOf(p)*(w-left-right)/Math.max(points.length-1,1)} y={h-10} fill="#8b97ac" textAnchor="middle" fontSize="10">{new Date(p.day+"T00:00:00Z").toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",timeZone:"UTC"})}</text>)}
  </svg>;
}
function StatusDonut({ statuses, total }:{statuses:DashboardReport["status"];total:number}){
  let current=0;
  const segments=statuses.map(s=>{const start=current;current+=s.share*100;return `${statusColors[s.status]||"#9caec8"} ${start.toFixed(2)}% ${current.toFixed(2)}%`;});
  return <div className="rv-donut-wrap"><div className="rv-donut" style={{background:total>0?`conic-gradient(${segments.join(",")})`:"#e9edf4"}} role="img" aria-label="Verteilung der Ticket-Status">
    <div className="rv-donut-center"><strong>{formatNumber(total)}</strong><span>Tickets</span></div></div>
    <div className="rv-donut-legend">{statuses.map(s=><div className="rv-legend-row" key={s.status}><span className="rv-legend-name"><i style={{background:statusColors[s.status]||"#9caec8"}}/>{statusNames[s.status]||s.status}</span><strong>{Math.round(s.share*100)}%</strong></div>)}
      {!statuses.length&&<span className="rv-empty-small">Keine Ticketdaten</span>}
    </div></div>;
}
function SectionHeading({title,description,action,handleAction}:{title:string;description?:string;action?:string;handleAction?:()=>void}){
  return <div className="rv-section-heading"><div><h2>{title}</h2>{description&&<p>{description}</p>}</div>
    {action&&handleAction&&<button type="button" className="rv-outline-button" onClick={handleAction}>{action}<ArrowRight size={13}/></button>}</div>;
}
function eventLabel(type:string){
  const known:Record<string,{name:string;detail:string}> = {
    ai_resolved:{name:"AI hat eine Anfrage gelöst",detail:"Automatisch beantwortete Unterhaltung"},
    conversation_created:{name:"Neue Unterhaltung",detail:"Eine Support-Anfrage wurde eröffnet"},
    ticket_created:{name:"Ticket erstellt",detail:"Neue Support-Anfrage erfasst"},
    handoff_requested:{name:"An Mitarbeiter übergeben",detail:"Persönliche Betreuung erforderlich"},
  };
  return known[type]||{name:type.replace(/[._]/g," ").replace(/\b\w/g,m=>m.toUpperCase()),detail:"Support-Aktivität"};
}
function safeMeetingUrl(input:string|null){
  if(!input)return null;
  try {const url=new URL(input);return url.protocol==="https:"?url.toString():null;}catch{return null;}
}

function OverviewTab({organizationId,user,onNavigate,onOpenTicket,canManage}:Props){
  const [days,setDays]=useState(30);
  const [data,setData]=useState<DashboardReport|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [reload,setReload]=useState(0);
  const [search,setSearch]=useState("");
  useEffect(()=>{
    if(!organizationId){setData(null);setLoading(false);return;}
    let active=true;setLoading(true);setError("");setData(null);
    void api.get("/analytics/dashboard",{params:{days}}).then(({data:payload})=>{
      if(active)setData(payload);
    }).catch(()=>{if(active)setError("Dashboard-Daten konnten nicht geladen werden.");}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[organizationId,days,reload]);
  const visibleTickets=useMemo(()=>data?.recentTickets.filter(t=>
    `${t.subject} ${t.customerName||""} ${t.number}`.toLowerCase().includes(search.toLowerCase()))||[],[data,search]);
  const metrics=data?.kpis;
  return <div className="rv-overview">
    <div className="rv-toolbar"><div className="rv-search"><Search size={17}/><input type="search" aria-label="Letzte Tickets durchsuchen" placeholder="Letzte Tickets durchsuchen ..." value={search} onChange={e=>setSearch(e.target.value)}/><kbd>Suche</kbd></div>
      <span className="rv-toolbar-workspace">Relvona Workspace</span><span className="rv-toolbar-user">{user?.avatarUrl?<img src={user.avatarUrl} alt=""/>:<span>{(user?.name||"R").slice(0,1)}</span>}<strong>{user?.name||"Support Team"}</strong></span></div>
    <div className="rv-overview-body">
      <div className="rv-welcome"><div><p className="rv-eyebrow">Schön, dass du da bist.</p><h1>Das passiert gerade bei Relvona</h1><p>AI-gestützter Support. Zufriedene Kunden. Ein produktives Team.</p></div>
        <div className="rv-date-controls"><label htmlFor="rv-range"><CalendarDays size={17}/><span className="sr-only">Zeitraum</span></label><select id="rv-range" value={days} onChange={e=>setDays(Number(e.target.value))}><option value={7}>Letzte 7 Tage</option><option value={30}>Letzte 30 Tage</option><option value={90}>Letzte 90 Tage</option></select><button type="button" aria-label="Dashboard aktualisieren" title="Dashboard aktualisieren" onClick={()=>setReload(v=>v+1)}>↻</button></div>
      </div>
      {loading&&<div role="status" className="rv-panel rv-loading">Dashboard-Daten werden geladen …</div>}
      {error&&<div role="alert" className="rv-error">{error} <button type="button" onClick={()=>setReload(v=>v+1)}>Erneut versuchen</button></div>}
      {!loading&&!error&&data&&metrics&&<>
        <div className="rv-kpi-grid">
          <MetricCard label="Support-Tickets" icon={Ticket} value={formatNumber(metrics.tickets)} detail="zum vorherigen Zeitraum" tone="#4c78f7" change={delta(metrics.tickets,metrics.previous.tickets)} spark={data.volume.map(x=>x.tickets)}/>
          <MetricCard label="Termine" icon={CalendarDays} value={formatNumber(metrics.appointments)} detail={`${metrics.upcomingAppointments} bevorstehend`} tone="#2686f4" change={delta(metrics.appointments,metrics.previous.appointments)}/>
          <MetricCard label="AI-Unterhaltungen" icon={Sparkles} value={formatNumber(metrics.conversations)} detail="zum vorherigen Zeitraum" tone="#9460f8" change={delta(metrics.conversations,metrics.previous.conversations)} spark={data.volume.map(x=>x.conversations)}/>
          <MetricCard label="Ø Antwortzeit" icon={Clock3} value={responseTime(metrics.averageFirstResponseMinutes)} detail="erste Antwort im Zeitraum" tone="#23b9a5"/>
          <MetricCard label="Kundenzufriedenheit" icon={Star} value={metrics.satisfactionRate===null?"—":`${Math.round(metrics.satisfactionRate*100)}%`} detail={`${metrics.feedbackCount} Bewertungen`} tone="#f2a94d"/>
        </div>
        <div className="rv-chart-grid">
          <section className="rv-panel rv-chart-panel rv-volume-panel">
            <SectionHeading title="Support-Volumen" description="Tickets und AI-Unterhaltungen im Zeitverlauf"/>
            <div className="rv-chart-legend"><span><i className="rv-dot-blue"/>Tickets</span><span><i className="rv-dot-purple"/>AI-Unterhaltungen</span></div>
            <VolumeChart points={data.volume}/>
          </section>
          <section className="rv-panel rv-chart-panel">
            <SectionHeading title="Ticket-Kategorien" description="Verteilung nach erstem Ticket-Tag"/>
            <div className="rv-categories">{data.categories.map((category,index)=><div className="rv-category-row" key={category.name}>
              <span title={category.name}>{category.name}</span><div className="rv-category-track"><div style={{width:`${category.share*100}%`,background:categoryColors[index%categoryColors.length]}}/></div><strong>{Math.round(category.share*100)}%</strong>
            </div>)}{!data.categories.length&&<p className="rv-empty-small">Noch keine Tickets in diesem Zeitraum.</p>}</div>
          </section>
          <section className="rv-panel rv-chart-panel">
            <SectionHeading title="Ticket-Status" description="Aktuelle Verteilung aller Tickets"/>
            <StatusDonut statuses={data.status} total={data.statusTotal}/>
          </section>
        </div>
        <div className="rv-bottom-grid">
          <section className="rv-panel rv-list-panel"><SectionHeading title="Letzte Tickets" action="Alle ansehen" handleAction={()=>onNavigate?.("tickets")}/>
            <div className="rv-list-content">{visibleTickets.map(ticket=><button type="button" className="rv-ticket-row" key={ticket.id} onClick={()=>onOpenTicket?.(ticket)}>
              <span className="rv-list-avatar"><Headphones size={16}/></span><span className="rv-row-copy"><strong>{ticket.subject}</strong><small>#{ticket.number} · {ticket.customerName||"Kunde"} · {relative(ticket.createdAt)}</small></span><span className={`rv-ticket-status rv-status-${ticket.status}`}>{statusNames[ticket.status]||ticket.status}</span>
            </button>)}{!visibleTickets.length&&<p className="rv-empty-small">{search?"Keine passenden Tickets in den letzten fünf Einträgen.":"Noch keine Tickets vorhanden."}</p>}</div>
          </section>
          <section className="rv-panel rv-list-panel"><SectionHeading title="Anstehende Termine" action={canManage?"Verwalten":undefined} handleAction={canManage?()=>window.location.assign("/admin/scheduling"):undefined}/>
            <div className="rv-list-content">{data.upcomingAppointments.map(booking=><div className="rv-appointment-row" key={booking.id}>
              <span className="rv-appointment-icon"><CalendarDays size={17}/></span><span className="rv-row-copy"><strong>{booking.title}</strong><small>{new Date(booking.startsAt).toLocaleString("de-DE",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})} – {new Date(booking.endsAt).toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})} · {booking.guestName||"Gast"}</small></span>
              {safeMeetingUrl(booking.meetingUrl)&&<a className="rv-join" href={safeMeetingUrl(booking.meetingUrl)!} target="_blank" rel="noopener noreferrer">Beitreten</a>}
            </div>)}{!data.upcomingAppointments.length&&<p className="rv-empty-small">Keine bevorstehenden Termine.</p>}</div>
          </section>
          <section className="rv-panel rv-list-panel"><SectionHeading title="Aktivitäten" action="Analytics" handleAction={()=>onNavigate?.("analytics")}/>
            <div className="rv-list-content">{data.activity.map(item=>{const event=eventLabel(item.eventType);return <div className="rv-activity-row" key={item.id}>
              <span className="rv-activity-icon"><Activity size={16}/></span><span className="rv-row-copy"><strong>{event.name}</strong><small>{event.detail}</small></span><time>{relative(item.createdAt)}</time>
            </div>;})}{!data.activity.length&&<p className="rv-empty-small">Noch keine Aktivitäten erfasst.</p>}</div>
          </section>
        </div>
        <p className="rv-data-note"><CheckCircle2 size={13}/> Live-Daten deiner Organisation · Stand {new Date(data.generatedAt).toLocaleString("de-DE")} · Keine Demo-Kennzahlen</p>
      </>}
    </div>
  </div>;
}
export default memo(OverviewTab);
