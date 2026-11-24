/**
 * Issue #1337 — `<EditRoomStudio>` shell.
 *
 * Re-exports the Prisma types the new surface reads, plus the SlotId →
 * variant-index adapter the shell and the runtime share. The "data"
 * file in the Magic Patterns design (`dVy8` data.ts) holds demo image
 * URLs and stub ROOMS; we do not export those from here — child slices
 * (#1338 TopBar, #1340 VersionStrip) will replace them with real
 * `Room` + `InpaintVersion` rows read from the parent route's loader.
 *
 * Centralizing the SlotId ↔ variant-index mapping here means the
 * lookbook slot the shell exposes (`A` / `B`) and the
 * `selectedVariantIndex` column on `Room` (0 / 1) stay consistent
 * across the shell, the version strip, and the lookbook mirror.
 */
