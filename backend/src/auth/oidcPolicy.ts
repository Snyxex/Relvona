import type { JWTPayload } from "jose";
export type OidcConfiguration = {
  enabled: boolean;
  label: string;
  issuer: string;
  clientId: string;
  clientSecretEncrypted?: string;
  allowedDomains: string[];
};
export function validateOidcConfiguration(value: unknown): OidcConfiguration {
  const v = value as Partial<OidcConfiguration>;
  if (v?.enabled === false && v.issuer === "" && v.clientId === "")
    return {
      enabled: false,
      label: "SSO",
      issuer: "",
      clientId: "",
      allowedDomains: [],
    };
  if (
    !v ||
    typeof v.enabled !== "boolean" ||
    typeof v.label !== "string" ||
    !v.label.trim() ||
    v.label.length > 80 ||
    typeof v.clientId !== "string" ||
    !v.clientId.trim() ||
    v.clientId.length > 300 ||
    typeof v.issuer !== "string" ||
    v.issuer.length > 500
  )
    throw Error("Ungültige OIDC-Konfiguration");
  const u = new URL(v.issuer);
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash)
    throw Error(
      "OIDC benötigt eine HTTPS-Issuer-URL ohne Zugangsdaten oder Parameter",
    );
  if (
    !Array.isArray(v.allowedDomains) ||
    !v.allowedDomains.length ||
    v.allowedDomains.length > 50 ||
    v.allowedDomains.some(
      (d) => typeof d !== "string" || !/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(d),
    )
  )
    throw Error("Mindestens eine gültige E-Mail-Domain ist erforderlich");
  return {
    enabled: v.enabled,
    label: v.label.trim(),
    issuer: v.issuer,
    clientId: v.clientId.trim(),
    allowedDomains: v.allowedDomains.map((d) => d.toLowerCase()),
  };
}
export function validateOidcClaims(
  c: JWTPayload,
  nonce: string,
  domains: string[],
) {
  if (
    typeof c.sub !== "string" ||
    !c.sub ||
    c.sub.length > 255 ||
    typeof c.exp !== "number" ||
    typeof c.iat !== "number" ||
    c.iat > Date.now() / 1000 + 60 ||
    c.nonce !== nonce ||
    c.email_verified !== true ||
    typeof c.email !== "string" ||
    !/^\S+@\S+\.\S+$/.test(c.email)
  )
    throw Error("SSO_CLAIMS_INVALID");
  const email = c.email.toLowerCase();
  if (!domains.includes(email.split("@")[1]))
    throw Error("SSO_DOMAIN_NOT_ALLOWED");
  return {
    subject: c.sub,
    email,
    name: typeof c.name === "string" ? c.name : email,
  };
}
