import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";

export type RequestDatabaseClient = {
  query: (...args: any[]) => Promise<any>;
  release: () => void;
};

type TenantContext = {
  organizationId?: string;
  requestClient?: RequestDatabaseClient;
  requestClientPromise?: Promise<RequestDatabaseClient>;
  appliedTenantId?: string;
  released?: boolean;
};
const storage = new AsyncLocalStorage<TenantContext>();

async function releaseRequestClient(context: TenantContext) {
  if (context.released) return;
  context.released = true;
  try {
    const client = context.requestClient || (context.requestClientPromise ? await context.requestClientPromise.catch(() => undefined) : undefined);
    if (!client) return;
    if (context.appliedTenantId) await client.query("RESET app.organization_id").catch(() => undefined);
    client.release();
    context.requestClient = undefined;
    context.requestClientPromise = undefined;
    context.appliedTenantId = undefined;
  } catch {
    // Pool clients must never leak even when cleanup races with a closed response.
  }
}

export function tenantContextMiddleware(_req: Request, res: Response, next: NextFunction) {
  storage.run({}, () => {
    const context = storage.getStore()!;
    let cleanupStarted = false;
    const cleanup = () => {
      if (cleanupStarted) return;
      cleanupStarted = true;
      void releaseRequestClient(context);
    };
    res.once("finish", cleanup);
    res.once("close", cleanup);
    next();
  });
}

export function withDatabaseTenantContext<T>(work: () => T): T {
  return storage.run({}, work);
}

export function hasDatabaseTenantContext() {
  return storage.getStore() !== undefined;
}

export function setDatabaseTenant(organizationId: string) {
  const active = storage.getStore();
  if (!active) throw new Error("Database tenant context was not initialized");
  if (active.appliedTenantId && active.appliedTenantId !== organizationId) throw new Error("Cross-tenant request rejected");
  active.organizationId = organizationId;
}

export function currentDatabaseTenant() {
  return storage.getStore()?.organizationId;
}

export function currentDatabaseContext() {
  return storage.getStore();
}
