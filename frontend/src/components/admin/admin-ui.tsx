import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export const adminControlClassName =
  "block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900";

export function AdminPage({
  children,
  width = "wide",
}: {
  children: ReactNode;
  width?: "narrow" | "wide";
}) {
  return (
    <main
      className={[
        "mx-auto w-full space-y-6",
        width === "narrow" ? "max-w-4xl" : "max-w-7xl",
      ].join(" ")}
    >
      {children}
    </main>
  );
}

export function AdminHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon?: LucideIcon;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-4">
        {Icon && (
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#edf2ff] text-[#416fed]">
            <Icon size={22} aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 space-y-2">
          <p className="rv-app-eyebrow uppercase">{eyebrow}</p>
          <h1 className="text-[#172742]">{title}</h1>
          <p className="max-w-3xl text-sm leading-relaxed text-[#667694]">
            {description}
          </p>
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

export function AdminPanel({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 space-y-5 rounded-2xl border border-[#e5eaf3] bg-white p-5 shadow-sm sm:p-6">
      {(title || description) && (
        <div className="space-y-1 border-b border-[#edf0f6] pb-4">
          {title && <h2 className="font-semibold text-[#172742]">{title}</h2>}
          {description && <p className="text-sm text-[#667694]">{description}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

type AdminButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
};

const buttonStyles = {
  primary: "border-[#416fed] bg-[#416fed] text-[#fff] hover:bg-[#315bc8]",
  secondary: "border-[#dce5f2] bg-white text-[#31518c] hover:bg-[#f1f5fb]",
  danger: "border-[#e7bcc5] bg-white text-[#a7354e] hover:bg-[#fff1f3]",
};

export function AdminButton({
  children,
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: AdminButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={[
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        buttonStyles[variant],
        className,
      ].join(" ")}
    >
      {children}
    </button>
  );
}

const noticeStyles = {
  info: "border-[#dce6fa] bg-[#edf3ff] text-[#31518c]",
  success: "border-[#ccece1] bg-[#eaf9f3] text-[#18755e]",
  error: "border-[#f3d2da] bg-[#fff1f3] text-[#ae3551]",
};

export function AdminNotice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "success" | "error";
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={[
        "rounded-xl border px-4 py-3 text-sm",
        noticeStyles[tone],
      ].join(" ")}
    >
      {children}
    </p>
  );
}

export function AdminEmpty({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[#dce5f2] bg-[#f8faff] px-5 py-10 text-center"
      role="status"
    >
      <Icon size={26} className="text-[#416fed]" aria-hidden="true" />
      <strong className="text-sm text-[#172742]">{title}</strong>
      <p className="max-w-lg text-sm text-[#667694]">{description}</p>
    </div>
  );
}

const badgeStyles = {
  neutral: "border-[#dce5f2] bg-[#f1f5fb] text-[#536584]",
  success: "border-[#ccece1] bg-[#eaf9f3] text-[#18755e]",
  warning: "border-[#f1dfb8] bg-[#fff8e9] text-[#805719]",
  danger: "border-[#f3d2da] bg-[#fff1f3] text-[#ae3551]",
};

export function AdminBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
        badgeStyles[tone],
      ].join(" ")}
    >
      {children}
    </span>
  );
}
