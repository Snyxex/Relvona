import { and, eq } from "drizzle-orm";
import { isIP } from "node:net";
import { db } from "../db/index.js";
import { mailServerSettings } from "../db/mailServerSchema.js";
import { customers, organizations } from "../db/schema.js";
import { bookingEvents, bookings, meetingTypes } from "../db/extendedCustomerExperienceSchema.js";
import { decryptSecret, encryptSecret } from "../utils/crypto.js";
import { SmtpService, type SmtpConfig, type SmtpSecurity } from "./smtpService.js";

export type MailServerInput = {
  enabled?: boolean;
  host?: string | null;
  port?: number;
  security?: SmtpSecurity;
  username?: string | null;
  password?: string | null;
  clearPassword?: boolean;
  fromEmail?: string | null;
  fromName?: string | null;
  replyTo?: string | null;
};

type MailServerRow = typeof mailServerSettings.$inferSelect;

const HOSTNAME = /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const SECURITY = new Set<SmtpSecurity>(["none", "starttls", "tls"]);

function optionalText(value: unknown, max: number) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("Invalid mail server configuration");
  const trimmed = value.trim();
  if (trimmed.length > max) throw new Error("Mail server value is too long");
  return trimmed || null;
}

export function isValidMailHost(host: string) {
  const normalized = host.trim();
  return normalized === "localhost" || Boolean(isIP(normalized)) || HOSTNAME.test(normalized);
}

export function isValidMailAddress(value: string) {
  return value.length <= 254 && EMAIL.test(value);
}

function smtpConfig(row: MailServerRow, passwordOverride?: string | null): SmtpConfig {
  const password = passwordOverride !== undefined ? passwordOverride : decryptSecret(row.passwordEncrypted);
  return {
    host: row.host || "",
    port: row.port,
    security: row.security as SmtpSecurity,
    username: row.username,
    password,
    connectionTimeoutMs: 8_000,
  };
}

function publicSettings(row: MailServerRow) {
  const { passwordEncrypted: _passwordEncrypted, ...safe } = row;
  return { ...safe, passwordConfigured: Boolean(row.passwordEncrypted) };
}

function validateCompleteConfig(config: {
  host: string | null;
  port: number;
  security: string;
  username: string | null;
  passwordConfigured: boolean;
  fromEmail: string | null;
  fromName: string;
  replyTo: string | null;
}) {
  if (!config.host || !isValidMailHost(config.host)) throw new Error("Ungültiger SMTP-Host.");
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error("Ungültiger SMTP-Port.");
  if (!SECURITY.has(config.security as SmtpSecurity)) throw new Error("Ungültiger SMTP-Sicherheitsmodus.");
  if (!config.fromEmail || !isValidMailAddress(config.fromEmail)) throw new Error("Eine gültige Absender-E-Mail ist erforderlich.");
  if (config.replyTo && !isValidMailAddress(config.replyTo)) throw new Error("Ungültige Reply-To-Adresse.");
  if (config.username && !config.passwordConfigured) throw new Error("Für SMTP-Authentifizierung ist ein Passwort erforderlich.");
  if (!config.username && config.passwordConfigured) throw new Error("Für ein SMTP-Passwort ist ein Benutzername erforderlich.");
}

async function rowFor(organizationId: string) {
  const [existing] = await db.select().from(mailServerSettings).where(eq(mailServerSettings.organizationId, organizationId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(mailServerSettings).values({ organizationId }).returning();
  return created;
}

function htmlEscape(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] || character);
}

function safeMeetingUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatAppointment(date: Date, timezone: string) {
  try {
    return new Intl.DateTimeFormat("de-DE", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: timezone,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export class MailServerService {
  static async get(organizationId: string) {
    return publicSettings(await rowFor(organizationId));
  }

  static async save(organizationId: string, input: MailServerInput) {
    const current = await rowFor(organizationId);
    const host = optionalText(input.host, 253);
    const username = optionalText(input.username, 320);
    const fromEmail = optionalText(input.fromEmail, 254);
    const fromName = optionalText(input.fromName, 120);
    const replyTo = optionalText(input.replyTo, 254);
    const suppliedPassword = input.password === undefined || input.password === null ? undefined : String(input.password);
    if (suppliedPassword !== undefined && suppliedPassword.length > 2_000) throw new Error("SMTP-Passwort ist zu lang.");

    const nextPasswordEncrypted = input.clearPassword === true
      ? null
      : suppliedPassword?.length
        ? encryptSecret(suppliedPassword)
        : current.passwordEncrypted;

    const next = {
      enabled: input.enabled === undefined ? current.enabled : input.enabled === true,
      host: host === undefined ? current.host : host,
      port: input.port === undefined ? current.port : input.port,
      security: input.security === undefined ? current.security : input.security,
      username: username === undefined ? current.username : username,
      passwordEncrypted: nextPasswordEncrypted,
      fromEmail: fromEmail === undefined ? current.fromEmail : fromEmail,
      fromName: fromName === undefined ? current.fromName : (fromName || "Relvona"),
      replyTo: replyTo === undefined ? current.replyTo : replyTo,
    };

    if (!Number.isInteger(next.port) || next.port < 1 || next.port > 65535) throw new Error("Ungültiger SMTP-Port.");
    if (!SECURITY.has(next.security as SmtpSecurity)) throw new Error("Ungültiger SMTP-Sicherheitsmodus.");
    if (next.host && !isValidMailHost(next.host)) throw new Error("Ungültiger SMTP-Host.");
    if (next.fromEmail && !isValidMailAddress(next.fromEmail)) throw new Error("Ungültige Absender-E-Mail.");
    if (next.replyTo && !isValidMailAddress(next.replyTo)) throw new Error("Ungültige Reply-To-Adresse.");
    if (next.enabled) validateCompleteConfig({ ...next, passwordConfigured: Boolean(next.passwordEncrypted) });

    const [saved] = await db.update(mailServerSettings).set({ ...next, updatedAt: new Date() })
      .where(eq(mailServerSettings.organizationId, organizationId)).returning();
    return publicSettings(saved);
  }

  static async verify(organizationId: string, input: MailServerInput = {}) {
    const current = await rowFor(organizationId);
    const suppliedPassword = typeof input.password === "string" && input.password.length ? input.password : undefined;
    const host = optionalText(input.host, 253) ?? current.host;
    const username = optionalText(input.username, 320);
    const fromEmail = optionalText(input.fromEmail, 254);
    const fromName = optionalText(input.fromName, 120);
    const replyTo = optionalText(input.replyTo, 254);
    const port = input.port ?? current.port;
    const security = input.security ?? current.security;
    const effectiveUsername = username === undefined ? current.username : username;
    const effectiveFromEmail = fromEmail === undefined ? current.fromEmail : fromEmail;
    const effectiveFromName = fromName === undefined ? current.fromName : (fromName || "Relvona");
    const effectiveReplyTo = replyTo === undefined ? current.replyTo : replyTo;
    const storedPassword = decryptSecret(current.passwordEncrypted);
    const password = suppliedPassword ?? storedPassword;

    validateCompleteConfig({
      host,
      port,
      security,
      username: effectiveUsername,
      passwordConfigured: Boolean(password),
      fromEmail: effectiveFromEmail,
      fromName: effectiveFromName,
      replyTo: effectiveReplyTo,
    });
    if (!host) throw new Error("Ungültiger SMTP-Host.");

    await SmtpService.verify({ host, port, security: security as SmtpSecurity, username: effectiveUsername, password });
    return true;
  }

  static async sendBookingConfirmation(organizationId: string, bookingId: string) {
    const settings = await rowFor(organizationId);
    if (!settings.enabled) return { sent: false, reason: "mail_disabled" as const };

    const [booking] = await db.select().from(bookings).where(and(eq(bookings.organizationId, organizationId), eq(bookings.id, bookingId))).limit(1);
    if (!booking) return { sent: false, reason: "booking_not_found" as const };

    const [meetingType] = await db.select().from(meetingTypes).where(and(eq(meetingTypes.organizationId, organizationId), eq(meetingTypes.id, booking.meetingTypeId))).limit(1);
    const [organization] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    const [customer] = booking.customerId
      ? await db.select({ email: customers.email, name: customers.name }).from(customers).where(and(eq(customers.organizationId, organizationId), eq(customers.id, booking.customerId))).limit(1)
      : [];

    const recipient = booking.guestEmail || customer?.email;
    if (!recipient || !isValidMailAddress(recipient)) return { sent: false, reason: "recipient_missing" as const };
    validateCompleteConfig({ ...settings, passwordConfigured: Boolean(settings.passwordEncrypted) });

    const guestName = booking.guestName || customer?.name || "Kunde";
    const organizationName = organization?.name || "Relvona";
    const meetingName = meetingType?.name || "Termin";
    const startsAt = formatAppointment(booking.startsAt, booking.timezone);
    const endsAt = formatAppointment(booking.endsAt, booking.timezone);
    const meetingUrl = safeMeetingUrl(booking.meetingUrl);
    const meetingUrlText = meetingUrl ? `\nTeilnahmelink: ${meetingUrl}` : "";
    const text = `Hallo ${guestName},\n\nIhr Termin bei ${organizationName} wurde bestätigt.\n\n${meetingName}\nBeginn: ${startsAt}\nEnde: ${endsAt}\nZeitzone: ${booking.timezone}${meetingUrlText}\n\nViele Grüße\n${organizationName}`;
    const meetingUrlHtml = meetingUrl ? `<p><strong>Teilnahmelink:</strong> <a href="${htmlEscape(meetingUrl)}">${htmlEscape(meetingUrl)}</a></p>` : "";
    const html = `<p>Hallo ${htmlEscape(guestName)},</p><p>Ihr Termin bei <strong>${htmlEscape(organizationName)}</strong> wurde bestätigt.</p><p><strong>${htmlEscape(meetingName)}</strong><br>Beginn: ${htmlEscape(startsAt)}<br>Ende: ${htmlEscape(endsAt)}<br>Zeitzone: ${htmlEscape(booking.timezone)}</p>${meetingUrlHtml}<p>Viele Grüße<br>${htmlEscape(organizationName)}</p>`;

    await SmtpService.send(smtpConfig(settings), {
      fromEmail: settings.fromEmail!,
      fromName: settings.fromName,
      to: recipient,
      replyTo: settings.replyTo,
      subject: `Terminbestätigung: ${meetingName}`,
      text,
      html,
    });

    await db.insert(bookingEvents).values({
      organizationId,
      bookingId,
      type: "email.confirmation_sent",
      actorType: "system",
      metadata: { channel: "email" },
    });
    return { sent: true as const };
  }

  static async recordBookingEmailFailure(organizationId: string, bookingId: string) {
    await db.insert(bookingEvents).values({
      organizationId,
      bookingId,
      type: "email.confirmation_failed",
      actorType: "system",
      metadata: { channel: "email" },
    });
  }
}
