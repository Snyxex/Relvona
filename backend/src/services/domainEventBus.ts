export type DomainEventType =
  | "conversation.created"
  | "conversation.updated"
  | "message.created"
  | "intent.detected"
  | "ticket.created"
  | "ticket.updated"
  | "tool.failed"
  | "customer.frustrated"
  | "ai.low_confidence"
  | "human_handoff.requested"
  | "booking.created"
  | "booking.rescheduled"
  | "booking.cancelled";

export interface DomainEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  type: DomainEventType;
  organizationId: string;
  conversationId?: string;
  payload: TPayload;
  occurredAt: Date;
}

type EventHandler = (event: DomainEvent) => void | Promise<void>;

export class DomainEventBus {
  private readonly handlers = new Map<DomainEventType, Set<EventHandler>>();

  subscribe(type: DomainEventType, handler: EventHandler) {
    const handlers = this.handlers.get(type) || new Set<EventHandler>();
    handlers.add(handler);
    this.handlers.set(type, handlers);
    return () => handlers.delete(handler);
  }

  async emit(event: Omit<DomainEvent, "occurredAt">) {
    const fullEvent: DomainEvent = { ...event, occurredAt: new Date() };
    const handlers = [...(this.handlers.get(event.type) || [])];
    await Promise.allSettled(handlers.map((handler) => handler(fullEvent)));
  }
}

export const domainEventBus = new DomainEventBus();
