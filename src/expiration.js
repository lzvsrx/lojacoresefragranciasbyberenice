export const EXPIRATION_WARNING_DAYS = 30;

export function storeToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type) => parts.find((value) => value.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function calendarDay(value) {
  const input = String(value ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input);
  if (!iso && !br) return null;
  const [year, month, day] = iso
    ? iso.slice(1).map(Number)
    : [Number(br[3]), Number(br[2]), Number(br[1])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return date.getTime() / 86400000;
}

export function expirationStatus(value, today = storeToday()) {
  const expiry = calendarDay(value);
  const current = calendarDay(today);
  if (expiry === null || current === null) return null;
  const days = expiry - current;
  if (days < 0)
    return { status: "expired", label: "Vencido", tone: "red", days };
  if (days <= EXPIRATION_WARNING_DAYS)
    return { status: "soon", label: "Quase vencendo", tone: "yellow", days };
  return { status: "valid", label: "Dentro da validade", tone: "green", days };
}
