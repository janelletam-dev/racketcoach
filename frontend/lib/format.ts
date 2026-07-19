type DateLike = Date | number | string;

function toDate(d: DateLike): Date {
  return d instanceof Date ? d : new Date(d);
}

export function formatDate(d: DateLike): string {
  return toDate(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatShortDate(d: DateLike): string {
  return toDate(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

/** Date and time, e.g. "5 Jul 2026, 14:32". */
export function formatDateTime(d: DateLike): string {
  return toDate(d).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Human duration from seconds, e.g. "5m 30s". Null-safe. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "-";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
