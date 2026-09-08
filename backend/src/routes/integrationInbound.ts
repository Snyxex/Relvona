import { Router, type Request } from "express";
import { setDatabaseTenant, withDatabaseTenantContext } from "../db/tenantContext.js";
import { IntegrationInboundService } from "../services/integrationInboundService.js";

const router = Router();
type RawBodyRequest = Request & { rawBody?: Buffer };

router.post("/:organizationId/:connectionId", async (req: RawBodyRequest, res) => {
  const signature = req.header("x-zendesk-webhook-signature") || "";
  const timestamp = req.header("x-zendesk-webhook-signature-timestamp") || "";
  const invocationId = req.header("x-zendesk-webhook-invocation-id") || "";
  const organizationId = req.params.organizationId;
  const connectionId = req.params.connectionId;

  try {
    const result = await withDatabaseTenantContext(async () => {
      setDatabaseTenant(organizationId);
      return IntegrationInboundService.verifyAndEnqueue({
        organizationId,
        connectionId,
        signature,
        timestamp,
        invocationId,
        rawBody: req.rawBody || Buffer.alloc(0),
        payload: req.body,
      });
    });
    return res.status(result.duplicate ? 200 : 202).json({ accepted: true, duplicate: result.duplicate });
  } catch (error) {
    const message = (error as Error).message;
    if (/payload|event|ticket id|ticket status|ticket priority|route/i.test(message)) return res.status(400).json({ error: "Invalid Zendesk webhook payload" });
    return res.status(401).json({ error: "Invalid Zendesk webhook authentication" });
  }
});

export default router;
