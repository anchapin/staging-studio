import { describe, expect, it } from "vitest";

import {
  BATCH_ROOM_ALLOWED_IMAGE_EXTENSIONS,
  BATCH_ROOM_FILE_NAME_MAX,
  BATCH_ROOM_MAX_ENTRIES,
  BATCH_ROOM_MAX_FILES,
  BATCH_ROOM_NAME_MAX,
  BATCH_ROOM_TYPE_MAX,
  batchRoomStoragePathPattern,
  batchRoomUploadUrlsRequestSchema,
  createRoomsBatchRequestSchema,
  isAllowedBatchImageExtension,
} from "@/lib/room-batch-schema";

const PROJECT_ID = "proj_abc123";

function validEntry(overrides: Record<string, unknown> = {}) {
  return {
    fileName: "living-room.jpg",
    roomType: "Living Room",
    beforeImageUrl: `https://ref.supabase.co/storage/v1/object/public/room-photos/batch-rooms/${PROJECT_ID}/room-0-1699999999999.jpg`,
    ...overrides,
  };
}

function validUploadFile(overrides: Record<string, unknown> = {}) {
  return { name: "living-room.jpg", ...overrides };
}

describe("batchRoomUploadUrlsRequestSchema", () => {
  const validRequest = {
    projectId: PROJECT_ID,
    files: [validUploadFile()],
  };

  it("accepts a minimal valid request", () => {
    const result = batchRoomUploadUrlsRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validRequest);
    }
  });

  it("accepts exactly BATCH_ROOM_MAX_FILES files", () => {
    const result = batchRoomUploadUrlsRequestSchema.safeParse({
      ...validRequest,
      files: Array.from({ length: BATCH_ROOM_MAX_FILES }, () =>
        validUploadFile()
      ),
    });
    expect(result.success).toBe(true);
  });

  it("rejects more than BATCH_ROOM_MAX_FILES files", () => {
    expect(
      batchRoomUploadUrlsRequestSchema.safeParse({
        ...validRequest,
        files: Array.from(
          { length: BATCH_ROOM_MAX_FILES + 1 },
          () => validUploadFile()
        ),
      }).success
    ).toBe(false);
  });

  it("rejects an empty or missing files array", () => {
    expect(
      batchRoomUploadUrlsRequestSchema.safeParse({ ...validRequest, files: [] })
        .success
    ).toBe(false);
    expect(
      batchRoomUploadUrlsRequestSchema.safeParse({
        projectId: PROJECT_ID,
      }).success
    ).toBe(false);
  });

  it("rejects a non-array files value", () => {
    expect(
      batchRoomUploadUrlsRequestSchema.safeParse({
        ...validRequest,
        files: "not-an-array",
      }).success
    ).toBe(false);
  });

  it("rejects an empty or missing projectId", () => {
    expect(
      batchRoomUploadUrlsRequestSchema.safeParse({
        projectId: "",
        files: [validUploadFile()],
      }).success
    ).toBe(false);
  });

  describe("file name bounds", () => {
    it("accepts every allowed extension, case-insensitively", () => {
      for (const ext of BATCH_ROOM_ALLOWED_IMAGE_EXTENSIONS) {
        expect(
          batchRoomUploadUrlsRequestSchema.safeParse({
            ...validRequest,
            files: [validUploadFile({ name: `photo.${ext.toUpperCase()}` })],
          }).success
        ).toBe(true);
      }
    });

    it("rejects a name with a disallowed extension", () => {
      expect(
        batchRoomUploadUrlsRequestSchema.safeParse({
          ...validRequest,
          files: [validUploadFile({ name: "photo.gif" })],
        }).success
      ).toBe(false);
    });

    it("rejects a name with no extension", () => {
      expect(
        batchRoomUploadUrlsRequestSchema.safeParse({
          ...validRequest,
          files: [validUploadFile({ name: "photo" })],
        }).success
      ).toBe(false);
    });

    it("rejects an empty name", () => {
      expect(
        batchRoomUploadUrlsRequestSchema.safeParse({
          ...validRequest,
          files: [validUploadFile({ name: "" })],
        }).success
      ).toBe(false);
    });

    it("rejects a name over the max bound", () => {
      expect(
        batchRoomUploadUrlsRequestSchema.safeParse({
          ...validRequest,
          files: [
            validUploadFile({
              name: `${"a".repeat(BATCH_ROOM_FILE_NAME_MAX - 4)}.jpg`,
            }),
          ],
        }).success
      ).toBe(true);
      expect(
        batchRoomUploadUrlsRequestSchema.safeParse({
          ...validRequest,
          files: [
            validUploadFile({
              name: `${"a".repeat(BATCH_ROOM_FILE_NAME_MAX - 3)}.jpg`,
            }),
          ],
        }).success
      ).toBe(false);
    });

    it("rejects unknown keys on a file entry (strict object)", () => {
      expect(
        batchRoomUploadUrlsRequestSchema.safeParse({
          ...validRequest,
          files: [validUploadFile({ size: 1024 })],
        }).success
      ).toBe(false);
    });
  });
});

describe("isAllowedBatchImageExtension", () => {
  it("accepts allowed extensions regardless of case", () => {
    expect(isAllowedBatchImageExtension("a.jpg")).toBe(true);
    expect(isAllowedBatchImageExtension("a.JPEG")).toBe(true);
    expect(isAllowedBatchImageExtension("a.WebP")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isAllowedBatchImageExtension("a.gif")).toBe(false);
    expect(isAllowedBatchImageExtension("a")).toBe(false);
    expect(isAllowedBatchImageExtension("")).toBe(false);
  });
});

describe("batchRoomStoragePathPattern", () => {
  it("matches the storage path this project's batch flow mints", () => {
    const pattern = batchRoomStoragePathPattern(PROJECT_ID);
    expect(
      pattern.test(
        `/storage/v1/object/public/room-photos/batch-rooms/${PROJECT_ID}/room-0-1699999999999.jpg`
      )
    ).toBe(true);
    expect(
      pattern.test(
        `/storage/v1/object/upload/sign/room-photos/batch-rooms/${PROJECT_ID}/room-12-42.png`
      )
    ).toBe(true);
  });

  it("rejects another project's folder, bare paths, and wrong shapes", () => {
    const pattern = batchRoomStoragePathPattern(PROJECT_ID);
    expect(
      pattern.test(
        `/storage/v1/object/public/room-photos/batch-rooms/other_project/room-0-1.jpg`
      )
    ).toBe(false);
    expect(pattern.test(`batch-rooms/${PROJECT_ID}/room-0.jpg`)).toBe(false);
    expect(
      pattern.test(
        `/storage/v1/object/public/room-photos/batch-rooms/${PROJECT_ID}/room-0-1.gif`
      )
    ).toBe(false);
    expect(
      pattern.test(
        `/storage/v1/object/public/room-photos/batch-rooms/${PROJECT_ID}/room-0-1.jpg/extra`
      )
    ).toBe(false);
  });

  it("escapes regex metacharacters in projectId", () => {
    const pattern = batchRoomStoragePathPattern("proj.1");
    expect(pattern.test(`/x/batch-rooms/projX1/room-0-1.jpg`)).toBe(false);
    expect(pattern.test(`/x/batch-rooms/proj.1/room-0-1.jpg`)).toBe(true);
  });
});

describe("createRoomsBatchRequestSchema", () => {
  const schema = () => createRoomsBatchRequestSchema(PROJECT_ID);

  it("accepts a minimal valid request without roomNames", () => {
    const request = {
      projectId: PROJECT_ID,
      entries: [validEntry()],
    };
    const result = schema().safeParse(request);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.entries).toEqual([validEntry()]);
    }
  });

  it("accepts exactly BATCH_ROOM_MAX_ENTRIES entries", () => {
    expect(
      schema().safeParse({
        projectId: PROJECT_ID,
        entries: Array.from({ length: BATCH_ROOM_MAX_ENTRIES }, () =>
          validEntry()
        ),
      }).success
    ).toBe(true);
  });

  it("rejects more than BATCH_ROOM_MAX_ENTRIES entries", () => {
    expect(
      schema().safeParse({
        projectId: PROJECT_ID,
        entries: Array.from({ length: BATCH_ROOM_MAX_ENTRIES + 1 }, () =>
          validEntry()
        ),
      }).success
    ).toBe(false);
  });

  it("rejects an empty entries array", () => {
    expect(
      schema().safeParse({ projectId: PROJECT_ID, entries: [] }).success
    ).toBe(false);
  });

  it("rejects unknown keys on the request and on an entry (strict objects)", () => {
    expect(
      schema().safeParse({
        projectId: PROJECT_ID,
        entries: [validEntry()],
        staleClientField: true,
      }).success
    ).toBe(false);
    expect(
      schema().safeParse({
        projectId: PROJECT_ID,
        entries: [validEntry({ extra: true })],
      }).success
    ).toBe(false);
  });

  describe("field bounds", () => {
    it("rejects an empty or oversized fileName", () => {
      expect(
        schema().safeParse({
          projectId: PROJECT_ID,
          entries: [validEntry({ fileName: "" })],
        }).success
      ).toBe(false);
      expect(
        schema().safeParse({
          projectId: PROJECT_ID,
          entries: [
            validEntry({ fileName: "a".repeat(BATCH_ROOM_FILE_NAME_MAX + 1) }),
          ],
        }).success
      ).toBe(false);
    });

    it("rejects an empty, oversized, or non-string roomType", () => {
      expect(
        schema().safeParse({
          projectId: PROJECT_ID,
          entries: [validEntry({ roomType: "   " })],
        }).success
      ).toBe(false);
      expect(
        schema().safeParse({
          projectId: PROJECT_ID,
          entries: [
            validEntry({ roomType: "a".repeat(BATCH_ROOM_TYPE_MAX + 1) }),
          ],
        }).success
      ).toBe(false);
      expect(
        schema().safeParse({
          projectId: PROJECT_ID,
          entries: [validEntry({ roomType: 42 })],
        }).success
      ).toBe(false);
    });

    it("trims roomType before enforcing the bound", () => {
      const result = schema().safeParse({
        projectId: PROJECT_ID,
        entries: [validEntry({ roomType: "  Living Room  " })],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.entries[0].roomType).toBe("Living Room");
      }
    });
  });

  describe("roomNames bounds", () => {
    it("accepts roomNames with valid entries and trims them", () => {
      const result = schema().safeParse({
        projectId: PROJECT_ID,
        entries: [validEntry()],
        roomNames: ["  Main Living Area  "],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.roomNames).toEqual(["Main Living Area"]);
      }
    });

    it("rejects an empty or oversized roomName", () => {
      expect(
        schema().safeParse({
          projectId: PROJECT_ID,
          entries: [validEntry()],
          roomNames: ["   "],
        }).success
      ).toBe(false);
      expect(
        schema().safeParse({
          projectId: PROJECT_ID,
          entries: [validEntry()],
          roomNames: ["a".repeat(BATCH_ROOM_NAME_MAX + 1)],
        }).success
      ).toBe(false);
    });

    it("rejects more than BATCH_ROOM_MAX_ENTRIES roomNames", () => {
      expect(
        schema().safeParse({
          projectId: PROJECT_ID,
          entries: [validEntry()],
          roomNames: Array.from(
            { length: BATCH_ROOM_MAX_ENTRIES + 1 },
            () => "Room"
          ),
        }).success
      ).toBe(false);
    });
  });

  describe("beforeImageUrl validation (issue #704 core)", () => {
    it("accepts the public supabase URL form for this project's batch path", () => {
      expect(
        schema().safeParse({
          projectId: PROJECT_ID,
          entries: [
            validEntry({
              beforeImageUrl: `https://ref.supabase.co/storage/v1/object/public/room-photos/batch-rooms/${PROJECT_ID}/room-3-1700000000000.webp`,
            }),
          ],
        }).success
      ).toBe(true);
    });

    it("accepts the signed supabase URL form (token query, sign path)", () => {
      expect(
        schema().safeParse({
          projectId: PROJECT_ID,
          entries: [
            validEntry({
              beforeImageUrl: `https://ref.supabase.co/storage/v1/object/upload/sign/room-photos/batch-rooms/${PROJECT_ID}/room-0-1699999999999.png?token=abc.def.ghi`,
            }),
          ],
        }).success
      ).toBe(true);
    });

    it("accepts a fal.ai https URL (allowlisted image host)", () => {
      expect(
        schema().safeParse({
          projectId: PROJECT_ID,
          entries: [
            validEntry({
              beforeImageUrl: "https://v3.fal.ai/media/images/staged-room.webp",
            }),
          ],
        }).success
      ).toBe(true);
    });

    it("rejects a non-https URL", () => {
      expect(
        schema().safeParse({
          projectId: PROJECT_ID,
          entries: [
            validEntry({
              beforeImageUrl: `http://ref.supabase.co/storage/v1/object/public/room-photos/batch-rooms/${PROJECT_ID}/room-0-1.jpg`,
            }),
          ],
        }).success
      ).toBe(false);
    });

    it("rejects a URL on a non-allowlisted host", () => {
      expect(
        schema().safeParse({
          projectId: PROJECT_ID,
          entries: [
            validEntry({
              beforeImageUrl: `https://evil.example.com/storage/v1/object/public/room-photos/batch-rooms/${PROJECT_ID}/room-0-1.jpg`,
            }),
          ],
        }).success
      ).toBe(false);
    });

    it("rejects a supabase URL scoped to another project's folder", () => {
      expect(
        schema().safeParse({
          projectId: PROJECT_ID,
          entries: [
            validEntry({
              beforeImageUrl:
                "https://ref.supabase.co/storage/v1/object/public/room-photos/batch-rooms/proj_other/room-0-1699999999999.jpg",
            }),
          ],
        }).success
      ).toBe(false);
    });

    it("rejects a supabase URL with the single-room storage prefix", () => {
      expect(
        schema().safeParse({
          projectId: PROJECT_ID,
          entries: [
            validEntry({
              beforeImageUrl:
                "https://ref.supabase.co/storage/v1/object/public/room-photos/rooms/room_789/before-image.jpg",
            }),
          ],
        }).success
      ).toBe(false);
    });

    it("rejects a supabase URL with an arbitrary object path", () => {
      expect(
        schema().safeParse({
          projectId: PROJECT_ID,
          entries: [
            validEntry({
              beforeImageUrl:
                "https://ref.supabase.co/storage/v1/object/public/room-photos/someone-else/photo.jpg",
            }),
          ],
        }).success
      ).toBe(false);
    });

    it("rejects a data: URL and a non-URL string", () => {
      expect(
        schema().safeParse({
          projectId: PROJECT_ID,
          entries: [
            validEntry({ beforeImageUrl: "data:image/png;base64,AAAA" }),
          ],
        }).success
      ).toBe(false);
      expect(
        schema().safeParse({
          projectId: PROJECT_ID,
          entries: [validEntry({ beforeImageUrl: "not a url" })],
        }).success
      ).toBe(false);
    });

    it("rejects a non-string beforeImageUrl", () => {
      expect(
        schema().safeParse({
          projectId: PROJECT_ID,
          entries: [validEntry({ beforeImageUrl: null })],
        }).success
      ).toBe(false);
    });
  });
});
