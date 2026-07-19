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
