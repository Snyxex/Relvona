import { Router } from "express";
import authRouter from "./auth.js";
import organizationsRouter from "./organizations.js";
import assistantsRouter from "./assistants.js";
import knowledgeRouter from "./knowledge.js";
import conversationsRouter from "./conversations.js";
import ticketsRouter from "./tickets.js";
import customersRouter from "./customers.js";
import agentsRouter from "./agents.js";
import analyticsRouter from "./analytics.js";
import widgetRouter from "./widget.js";
import adminSettingsRouter from "./adminSettings.js";
import toolsRouter from "./tools.js";

const apiRouter = Router();

apiRouter.use("/v1/auth", authRouter);
apiRouter.use("/v1/organizations", organizationsRouter);
apiRouter.use("/v1/assistants", assistantsRouter);
apiRouter.use("/v1/knowledge", knowledgeRouter);
apiRouter.use("/v1/conversations", conversationsRouter);
apiRouter.use("/v1/tickets", ticketsRouter);
apiRouter.use("/v1/customers", customersRouter);
apiRouter.use("/v1/agents", agentsRouter);
apiRouter.use("/v1/analytics", analyticsRouter);
apiRouter.use("/v1/widget", widgetRouter);
apiRouter.use("/v1/admin", adminSettingsRouter);
apiRouter.use("/v1/tools", toolsRouter);

export default apiRouter;
