type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;

type UnsubscribeFn = () => void;

interface DomainEvent {
  readonly name: string;
  readonly occurredAt: Date;
}

export interface ProjectCreatedEvent extends DomainEvent {
  name: "ProjectCreated";
  payload: {
    projectId: string;
    userId: string;
    propertyAddress: string;
    clientName: string;
  };
}

export interface RoomStagedEvent extends DomainEvent {
  name: "RoomStaged";
  payload: {
    roomId: string;
    projectId: string;
    roomName: string;
  };
}

export interface InpaintCompletedEvent extends DomainEvent {
  name: "InpaintCompleted";
  payload: {
    inpaintRequestId: string;
    roomId: string;
    variantSlot: number;
    resultUrl: string;
  };
}

export interface ProjectSignedEvent extends DomainEvent {
  name: "ProjectSigned";
  payload: {
    projectId: string;
    timestamp: Date;
  };
}

export interface PdfExportedEvent extends DomainEvent {
  name: "PdfExported";
  payload: {
    projectId: string;
    exportedAt: Date;
  };
}

export type DomainEventType =
  | ProjectCreatedEvent
  | RoomStagedEvent
  | InpaintCompletedEvent
  | ProjectSignedEvent
  | PdfExportedEvent;

class EventEmitter {
  private handlers = new Map<string, Set<EventHandler>>();

  subscribe<T extends DomainEventType["name"]>(
    event: T,
    handler: EventHandler<Extract<DomainEventType, { name: T }>>,
  ): UnsubscribeFn {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler);
    return () => this.unsubscribe(event, handler as EventHandler);
  }

  unsubscribe(event: string, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  async emit<T extends DomainEventType>(event: T): Promise<void> {
    const handlers = this.handlers.get(event.name);
    if (!handlers || handlers.size === 0) return;
    const fire = async (handler: EventHandler) => {
      try {
        await handler({ ...event, occurredAt: new Date() } as DomainEventType);
      } catch {
        // fire-and-forget
      }
    };
    await Promise.allSettled([...handlers].map(fire));
  }
}

declare global {
  var __eventBus: EventEmitter | undefined;
}

export const eventBus: EventEmitter =
  globalThis.__eventBus ?? new EventEmitter();

if (process.env.NODE_ENV !== "production") {
  globalThis.__eventBus = eventBus;
}
