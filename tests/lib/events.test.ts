import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { eventBus, ProjectCreatedEvent } from "@/lib/events";

describe("eventBus", () => {
  beforeEach(() => {
    // Reset the global event bus between tests
    if (globalThis.__eventBus) {
      // @ts-expect-error - accessing private map to clear handlers
      globalThis.__eventBus.handlers.clear();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("subscribe and unsubscribe", () => {
    it("calls handler when matching event is emitted", async () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.subscribe("ProjectCreated", handler);

      const event: ProjectCreatedEvent = {
        name: "ProjectCreated",
        occurredAt: new Date(),
        payload: {
          projectId: "proj_1",
          userId: "user_1",
          propertyAddress: "123 Main St",
          clientName: "Jane Doe",
        },
      };

      await eventBus.emit(event);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event);

      unsubscribe();
    });

    it("does not call handler after unsubscribe", async () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.subscribe("ProjectCreated", handler);
      unsubscribe();

      await eventBus.emit({
        name: "ProjectCreated",
        occurredAt: new Date(),
        payload: {
          projectId: "proj_1",
          userId: "user_1",
          propertyAddress: "123 Main St",
          clientName: "Jane Doe",
        },
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it("supports multiple handlers for the same event", async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      eventBus.subscribe("RoomStaged", handler1);
      eventBus.subscribe("RoomStaged", handler2);

      await eventBus.emit({
        name: "RoomStaged",
        occurredAt: new Date(),
        payload: {
          roomId: "room_1",
          projectId: "proj_1",
          roomName: "Primary Bedroom",
        },
      });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("only calls handlers for the subscribed event name", async () => {
      const handler = vi.fn();
      eventBus.subscribe("ProjectSigned", handler);

      await eventBus.emit({
        name: "ProjectCreated",
        occurredAt: new Date(),
        payload: {
          projectId: "proj_1",
          userId: "user_1",
          propertyAddress: "123 Main St",
          clientName: "Jane Doe",
        },
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it("returns unsubscribe function that removes handler", async () => {
      const handler = vi.fn();
      const unsubscribe = eventBus.subscribe("InpaintCompleted", handler);

      // @ts-expect-error - accessing private map to verify initial state
      const handlersBefore = globalThis.__eventBus.handlers.get("InpaintCompleted")?.size;

      unsubscribe();

      // @ts-expect-error - accessing private map to verify final state
      const handlersAfter = globalThis.__eventBus.handlers.get("InpaintCompleted")?.size;
      expect(handlersBefore).toBe(1);
      expect(handlersAfter).toBe(0);
    });
  });

  describe("event types", () => {
    it("emits ProjectCreated with correct payload", async () => {
      const handler = vi.fn();
      eventBus.subscribe("ProjectCreated", handler);

      const event: ProjectCreatedEvent = {
        name: "ProjectCreated",
        occurredAt: new Date(),
        payload: {
          projectId: "proj_abc",
          userId: "user_xyz",
          propertyAddress: "456 Oak Ave",
          clientName: "John Smith",
        },
      };

      await eventBus.emit(event);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "ProjectCreated",
          payload: expect.objectContaining({
            projectId: "proj_abc",
            userId: "user_xyz",
            propertyAddress: "456 Oak Ave",
            clientName: "John Smith",
          }),
        }),
      );
    });

    it("emits RoomStaged with correct payload", async () => {
      const handler = vi.fn();
      eventBus.subscribe("RoomStaged", handler);

      await eventBus.emit({
        name: "RoomStaged",
        occurredAt: new Date(),
        payload: {
          roomId: "room_kitchen",
          projectId: "proj_123",
          roomName: "Kitchen",
        },
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "RoomStaged",
          payload: expect.objectContaining({
            roomId: "room_kitchen",
            projectId: "proj_123",
            roomName: "Kitchen",
          }),
        }),
      );
    });

    it("emits InpaintCompleted with correct payload", async () => {
      const handler = vi.fn();
      eventBus.subscribe("InpaintCompleted", handler);

      await eventBus.emit({
        name: "InpaintCompleted",
        occurredAt: new Date(),
        payload: {
          inpaintRequestId: "inpaint_001",
          roomId: "room_1",
          variantSlot: 1,
          resultUrl: "https://storage.example.com/result.png",
        },
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "InpaintCompleted",
          payload: expect.objectContaining({
            inpaintRequestId: "inpaint_001",
            roomId: "room_1",
            variantSlot: 1,
            resultUrl: "https://storage.example.com/result.png",
          }),
        }),
      );
    });

    it("emits ProjectSigned with correct payload", async () => {
      const handler = vi.fn();
      eventBus.subscribe("ProjectSigned", handler);
      const signedAt = new Date();

      await eventBus.emit({
        name: "ProjectSigned",
        occurredAt: signedAt,
        payload: {
          projectId: "proj_signed",
          timestamp: signedAt,
        },
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "ProjectSigned",
          payload: expect.objectContaining({
            projectId: "proj_signed",
            timestamp: signedAt,
          }),
        }),
      );
    });

    it("emits PdfExported with correct payload", async () => {
      const handler = vi.fn();
      eventBus.subscribe("PdfExported", handler);
      const exportedAt = new Date();

      await eventBus.emit({
        name: "PdfExported",
        occurredAt: exportedAt,
        payload: {
          projectId: "proj_export",
          exportedAt,
        },
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "PdfExported",
          payload: expect.objectContaining({
            projectId: "proj_export",
            exportedAt,
          }),
        }),
      );
    });
  });

  describe("fire-and-forget semantics", () => {
    it("does not throw when handler throws", async () => {
      const handler = vi.fn().mockRejectedValue(new Error("handler error"));
      eventBus.subscribe("ProjectCreated", handler);

      await expect(
        eventBus.emit({
          name: "ProjectCreated",
          occurredAt: new Date(),
          payload: {
            projectId: "proj_1",
            userId: "user_1",
            propertyAddress: "123 Main St",
            clientName: "Jane Doe",
          },
        }),
      ).resolves.not.toThrow();

      expect(handler).toHaveBeenCalled();
    });

    it("resolves even when no handlers are subscribed", async () => {
      await expect(
        eventBus.emit({
          name: "ProjectCreated",
          occurredAt: new Date(),
          payload: {
            projectId: "proj_1",
            userId: "user_1",
            propertyAddress: "123 Main St",
            clientName: "Jane Doe",
          },
        }),
      ).resolves.toBeUndefined();
    });

    it("awaits all handlers in parallel", async () => {
      const delays = [10, 20, 5];
      const results: number[] = [];

      const makeHandler = (id: number, delay: number) =>
        vi.fn(async () => {
          await new Promise((r) => setTimeout(r, delay));
          results.push(id);
        });

      const h1 = makeHandler(1, delays[0]);
      const h2 = makeHandler(2, delays[1]);
      const h3 = makeHandler(3, delays[2]);

      eventBus.subscribe("RoomStaged", h1);
      eventBus.subscribe("RoomStaged", h2);
      eventBus.subscribe("RoomStaged", h3);

      const start = Date.now();
      await eventBus.emit({
        name: "RoomStaged",
        occurredAt: new Date(),
        payload: { roomId: "r", projectId: "p", roomName: "Kitchen" },
      });
      const elapsed = Date.now() - start;

      // All handlers should complete; total time should be close to max delay
      expect(elapsed).toBeLessThan(Math.max(...delays) + 50);
      expect(results.sort()).toEqual([1, 2, 3]);
    });
  });

  describe("singleton behavior", () => {
    it("is available on globalThis for singleton preservation", () => {
      expect(globalThis.__eventBus).toBeDefined();
      expect(globalThis.__eventBus).toBe(eventBus);
    });
  });
});
