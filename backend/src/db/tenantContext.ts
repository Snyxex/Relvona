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
  releaseRegistered?: boolean;
};
const storage = new AsyncLocalStorage<TenantContext>();

export function tenantContextMiddleware(_req: Request, _res: Response, next: NextFunction) {
  storage.run({}, next);
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
  active.organizationId = organizationId;
}

export function currentDatabaseTenant() {
  return storage.getStore()?.organizationId;
}

export function currentDatabaseContext() {
  return storage.getStore();
}
