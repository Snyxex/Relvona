export class CustomerPortalDeliveryService {
  static async sendMagicLink(data: { organizationId: string; email: string; magicLink: string; purpose: "verify" | "login" }) {
    const webhookUrl = process.env.PORTAL_MAGIC_LINK_WEBHOOK_URL;
    if (!webhookUrl) {
      if (process.env.NODE_ENV === "production") throw new Error("PORTAL_MAGIC_LINK_WEBHOOK_URL is required when customer portal delivery is enabled");
      console.info(JSON.stringify({ level: "info", event: "customer_portal.magic_link.dev", organizationId: data.organizationId, email: data.email, purpose: data.purpose, magicLink: data.magicLink }));
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    timeout.unref?.();
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(process.env.PORTAL_MAGIC_LINK_WEBHOOK_SECRET ? { Authorization: `Bearer ${process.env.PORTAL_MAGIC_LINK_WEBHOOK_SECRET}` } : {}),
        },
        body: JSON.stringify({
          type: "customer_portal.magic_link",
          organizationId: data.organizationId,
          recipient: data.email,
          purpose: data.purpose,
          magicLink: data.magicLink,
        }),
      });
      if (!response.ok) throw new Error(`Portal delivery webhook returned ${response.status}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
