import net from "node:net";
import tls from "node:tls";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

export type SmtpSecurity = "none" | "starttls" | "tls";

export type SmtpConfig = {
  host: string;
  port: number;
  security: SmtpSecurity;
  username?: string | null;
  password?: string | null;
  connectionTimeoutMs?: number;
};

export type SmtpMessage = {
  fromEmail: string;
  fromName?: string | null;
  to: string;
  replyTo?: string | null;
  subject: string;
  text: string;
  html: string;
};

type SocketLike = net.Socket | tls.TLSSocket;

function cleanHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodedWord(value: string) {
  const clean = cleanHeader(value);
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function base64Lines(value: string) {
  const encoded = Buffer.from(value, "utf8").toString("base64");
  return encoded.match(/.{1,76}/g)?.join("\r\n") || "";
}

function messageIdDomain(fromEmail: string) {
  const domain = fromEmail.split("@")[1]?.replace(/[^a-zA-Z0-9.-]/g, "");
  return domain || "relvona.local";
}

export function buildMimeMessage(message: SmtpMessage) {
  const boundary = `relvona-${randomUUID()}`;
  const fromName = message.fromName ? `${encodedWord(message.fromName)} ` : "";
  const headers = [
    `From: ${fromName}<${cleanHeader(message.fromEmail)}>`,
    `To: <${cleanHeader(message.to)}>`,
    message.replyTo ? `Reply-To: <${cleanHeader(message.replyTo)}>` : null,
    `Subject: ${encodedWord(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${messageIdDomain(message.fromEmail)}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean);

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(message.text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(message.html),
    `--${boundary}--`,
    "",
  ];
  return [...headers, "", ...body].join("\r\n");
}

class SmtpConnection {
  private socket!: SocketLike;
  private buffer = "";
  private lines: string[] = [];
  private waiters: Array<(line: string) => void> = [];
  private readonly timeoutMs: number;

  constructor(private readonly config: SmtpConfig) {
    this.timeoutMs = Math.max(1_000, Math.min(config.connectionTimeoutMs ?? 8_000, 30_000));
  }

  private attach(socket: SocketLike) {
    this.socket = socket;
    this.buffer = "";
    this.lines = [];
    this.waiters = [];
    socket.setTimeout(this.timeoutMs);
    socket.on("timeout", () => socket.destroy(new Error("SMTP connection timed out")));
    socket.on("data", (chunk) => {
      this.buffer += chunk.toString("utf8");
      let offset = this.buffer.indexOf("\r\n");
      while (offset >= 0) {
        const line = this.buffer.slice(0, offset);
        this.buffer = this.buffer.slice(offset + 2);
        const waiter = this.waiters.shift();
        if (waiter) waiter(line); else this.lines.push(line);
        offset = this.buffer.indexOf("\r\n");
      }
    });
  }

  private nextLine() {
    const existing = this.lines.shift();
    if (existing !== undefined) return Promise.resolve(existing);
    return new Promise<string>((resolve, reject) => {
      const onError = (error: Error) => { cleanup(); reject(error); };
      const onClose = () => { cleanup(); reject(new Error("SMTP connection closed")); };
      const cleanup = () => {
        this.socket.off("error", onError);
        this.socket.off("close", onClose);
      };
      this.socket.once("error", onError);
      this.socket.once("close", onClose);
      this.waiters.push((line) => { cleanup(); resolve(line); });
    });
  }

  private async response() {
    const lines: string[] = [];
    while (true) {
      const line = await this.nextLine();
      lines.push(line);
      if (/^\d{3} /.test(line)) break;
      if (!/^\d{3}-/.test(line) && lines.length > 50) throw new Error("Invalid SMTP response");
    }
    const code = Number(lines.at(-1)?.slice(0, 3));
    return { code, text: lines.join("\n") };
  }

  private write(line: string) {
    return new Promise<void>((resolve, reject) => {
      this.socket.write(`${line}\r\n`, (error) => error ? reject(error) : resolve());
    });
  }

  private async command(line: string, expected: number | number[]) {
    await this.write(line);
    const result = await this.response();
    const expectedCodes = Array.isArray(expected) ? expected : [expected];
    if (!expectedCodes.includes(result.code)) throw new Error(`SMTP command rejected (${result.code || "unknown"})`);
    return result;
  }

  async connect() {
    if (this.config.security === "tls") {
      const socket = tls.connect({
        host: this.config.host,
        port: this.config.port,
        servername: isIP(this.config.host) ? undefined : this.config.host,
        rejectUnauthorized: true,
      });
      await new Promise<void>((resolve, reject) => {
        socket.once("secureConnect", resolve);
        socket.once("error", reject);
        socket.setTimeout(this.timeoutMs, () => reject(new Error("SMTP TLS connection timed out")));
      });
      this.attach(socket);
    } else {
      const socket = net.connect({ host: this.config.host, port: this.config.port });
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
        socket.setTimeout(this.timeoutMs, () => reject(new Error("SMTP connection timed out")));
      });
      this.attach(socket);
    }

    const greeting = await this.response();
    if (greeting.code !== 220) throw new Error(`SMTP greeting rejected (${greeting.code || "unknown"})`);
    let capabilities = await this.command("EHLO relvona.local", 250);

    if (this.config.security === "starttls") {
      if (!/STARTTLS/i.test(capabilities.text)) throw new Error("SMTP server does not advertise STARTTLS");
      await this.command("STARTTLS", 220);
      this.socket.removeAllListeners("data");
      const secureSocket = tls.connect({
        socket: this.socket,
        servername: isIP(this.config.host) ? undefined : this.config.host,
        rejectUnauthorized: true,
      });
      await new Promise<void>((resolve, reject) => {
        secureSocket.once("secureConnect", resolve);
        secureSocket.once("error", reject);
      });
      this.attach(secureSocket);
      capabilities = await this.command("EHLO relvona.local", 250);
    }

    const username = this.config.username?.trim();
    const password = this.config.password ?? "";
    if (username || password) {
      if (!username || !password) throw new Error("SMTP username and password must both be configured");
      if (/AUTH[^\r\n]*\bPLAIN\b/i.test(capabilities.text)) {
        const token = Buffer.from(`\u0000${username}\u0000${password}`, "utf8").toString("base64");
        await this.command(`AUTH PLAIN ${token}`, 235);
      } else {
        await this.command("AUTH LOGIN", 334);
        await this.command(Buffer.from(username, "utf8").toString("base64"), 334);
        await this.command(Buffer.from(password, "utf8").toString("base64"), 235);
      }
    }
  }

  async verify() {
    await this.connect();
    await this.command("NOOP", 250);
  }

  async send(message: SmtpMessage) {
    await this.connect();
    await this.command(`MAIL FROM:<${message.fromEmail}>`, 250);
    await this.command(`RCPT TO:<${message.to}>`, [250, 251]);
    await this.command("DATA", 354);
    const mime = buildMimeMessage(message).replace(/(^|\r\n)\./g, "$1..");
    await new Promise<void>((resolve, reject) => {
      this.socket.write(`${mime}\r\n.\r\n`, (error) => error ? reject(error) : resolve());
    });
    const result = await this.response();
    if (result.code !== 250) throw new Error(`SMTP message rejected (${result.code || "unknown"})`);
  }

  async close() {
    if (!this.socket || this.socket.destroyed) return;
    try { await this.command("QUIT", 221); } catch { /* connection may already be closed */ }
    this.socket.end();
  }
}

export class SmtpService {
  static async verify(config: SmtpConfig) {
    const session = new SmtpConnection(config);
    try { await session.verify(); } finally { await session.close(); }
  }

  static async send(config: SmtpConfig, message: SmtpMessage) {
    const session = new SmtpConnection(config);
    try { await session.send(message); } finally { await session.close(); }
  }
}
