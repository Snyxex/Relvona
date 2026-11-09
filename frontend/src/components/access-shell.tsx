import type { ReactNode } from "react";
import { ArrowLeft, MessageSquare, ShieldCheck } from "lucide-react";

export default function AccessShell({
  title,
  description,
  eyebrow = "DEIN ZUGANG",
  children,
}: {
  title: string;
  description: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  return (
    <main className="rv-app-surface rv-access-page">
      <header className="rv-access-header">
        <a href="/" className="rv-app-brand">
          <span aria-hidden="true">R</span>Relvona
        </a>
        <a href="/" className="rv-access-back">
          <ArrowLeft size={16} aria-hidden="true" /> Zur Startseite
        </a>
      </header>
      <div className="rv-access-layout">
        <aside className="rv-access-intro">
          <span className="rv-access-symbol">
            <MessageSquare size={30} aria-hidden="true" />
          </span>
          <p className="rv-access-eyebrow">RELVONA · CUSTOMER SUPPORT</p>
          <h2>
            Ein Ort für
            <br />
            guten Support.
          </h2>
          <p>
            Menschen, Wissen und KI verbinden. Damit aus jeder Anfrage der
            nächste gute Schritt wird.
          </p>
          <div className="rv-access-trust">
            <ShieldCheck size={20} aria-hidden="true" />
            <span>Dein Zugang zu Relvona</span>
          </div>
        </aside>
        <section className="rv-access-card" aria-labelledby="rv-access-title">
          <div className="rv-access-card-heading">
            <p className="rv-app-eyebrow">{eyebrow}</p>
            <h1 id="rv-access-title">{title}</h1>
            <p>{description}</p>
          </div>
          {children}
        </section>
      </div>
      <footer className="rv-access-footer">
        Relvona · Support mit Menschen und KI
      </footer>
    </main>
  );
}
