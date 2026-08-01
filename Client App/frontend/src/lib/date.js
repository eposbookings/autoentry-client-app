const UK_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const UK_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parseDateValue(value) {
  if (value instanceof Date) return value;
  const text = String(value ?? "").trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  return new Date(value);
}

export function formatUkDate(value, fallback = "-") {
  if (value === null || value === undefined || value === "") return fallback;
  const date = parseDateValue(value);
  return Number.isNaN(date.getTime()) ? String(value) : UK_DATE_FORMATTER.format(date);
}

export function formatUkDateTime(value, fallback = "-") {
  if (value === null || value === undefined || value === "") return fallback;
  const date = parseDateValue(value);
  return Number.isNaN(date.getTime()) ? String(value) : UK_DATE_TIME_FORMATTER.format(date);
}
