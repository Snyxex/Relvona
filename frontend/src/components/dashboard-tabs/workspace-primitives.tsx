"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function WorkspaceHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="rv-section-header">
      <div>
        <p className="rv-section-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="rv-section-intro">{description}</p>
      </div>
      {children && <div className="rv-section-actions">{children}</div>}
    </header>
  );
}

export function WorkspacePanel({
  title,
  description,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rv-section-panel ${className}`}>
      {(title || description) && (
        <div className="rv-section-panel-heading">
          {title && <h2>{title}</h2>}
          {description && <p>{description}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

export function WorkspaceMetric({
  label,
  value,
  description,
  icon: Icon,
  tone = "blue",
}: {
  label: string;
  value: string | number;
  description?: string;
  icon: LucideIcon;
  tone?: "blue" | "violet" | "mint" | "amber";
}) {
  return (
    <article className="rv-section-metric">
      <div className="rv-section-metric-heading">
        <span className={`rv-section-metric-icon rv-tone-${tone}`}>
          <Icon size={19} aria-hidden="true" />
        </span>
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      {description && <small>{description}</small>}
    </article>
  );
}

export function WorkspaceEmpty({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="rv-section-empty" role="status">
      <span className="rv-section-empty-icon">
        <Icon size={24} aria-hidden="true" />
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
