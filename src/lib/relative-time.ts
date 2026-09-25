/**
 * Shared date formatting (issue #713).
 *
 * formatRelativeTime renders the compact relative labels used by the
 * version-history pills and panel ("just now" / "Xm ago" / "Xh ago" /
 * "Xd ago"), falling back to a locale-formatted absolute date past a
 * week. It previously lived verbatim in both version-history components;
 * fixes now land once here.
 *
 * formatLongDate renders the long en-US date ("September 23, 2026") used
 * by the signoff and consultation-report pages, which previously rolled
 * their own toLocaleDateString options inline.
 *
 * Both accept Date | string | number because createdAt crosses the
 * server-action boundary as a serialized timestamp; `new Date()` accepts
 * all three shapes.
 */

/** Formats a (possibly serialized) timestamp as a short relative label. */
export function formatRelativeTime(
  date: Date | string | number,
  now: Date | number = Date.now()
): string {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const target = new Date(date);
  const diff = nowMs - target.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return target.toLocaleDateString();
}

/** Formats a (possibly serialized) timestamp as e.g. "September 23, 2026". */
export function formatLongDate(date: Date | string | number): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
