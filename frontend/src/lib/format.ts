// Formateadores de presentacion. El kit no trae ninguno.
//
// Convencion de la familia: una celda sin valor se pinta con una raya (—), nunca
// con cadena vacia ni "N/A".

export const EMPTY = "—";

/** Tamano de archivo legible. Base 1024, porque el API cuenta bytes reales. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return EMPTY;
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  // Un decimal a partir de MB; por debajo los decimales no aportan nada.
  return `${value.toFixed(exponent < 2 ? 0 : 1)} ${units[exponent]}`;
}

const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dateOnly = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const timeOnly = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return dateTime.format(date);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return dateOnly.format(date);
}

/**
 * Ventana temporal del run. Si empieza y acaba el mismo dia se omite la fecha del
 * final, que es la forma en que un ingeniero lee un run: "12 Mar 2026 10:04 → 10:19".
 */
export function formatRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start && !end) return EMPTY;
  if (!start) return `… → ${formatDateTime(end)}`;
  if (!end) return `${formatDateTime(start)} → …`;

  const from = new Date(start);
  const to = new Date(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return EMPTY;

  const sameDay = from.toDateString() === to.toDateString();
  return sameDay
    ? `${dateTime.format(from)} → ${timeOnly.format(to)}`
    : `${dateTime.format(from)} → ${dateTime.format(to)}`;
}

/** Duracion del run a partir de su ventana, en la forma compacta 1h 23m. */
export function formatDuration(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start || !end) return EMPTY;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (Number.isNaN(ms) || ms < 0) return EMPTY;
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 1) return "<1m";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

/**
 * Antiguedad legible ("2 hours ago"). En un catalogo cronologico lo que se busca
 * casi siempre es "lo de esta semana", y para eso una distancia se lee mas rapido
 * que una fecha absoluta. La fecha exacta se deja en el `title` de la celda.
 */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY;

  let duration = (date.getTime() - Date.now()) / 1000;
  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return relative.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return formatDate(iso);
}

const number = new Intl.NumberFormat("en");

/** Entero con separador de millares, para que 1248 no se lea como 124.8. */
export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? EMPTY : number.format(value);
}

/**
 * Etiqueta de una carpeta mensual de Drive ("2026_10" -> "Oct 2026"). Es la clave
 * que devuelve `stats.byFolder`, y asi se puede pintar en un eje.
 */
export function formatMonthKey(key: string): string {
  const match = /^(\d{4})_(\d{2})$/.exec(key);
  if (!match) return key;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  if (Number.isNaN(date.getTime())) return key;
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
  }).format(date);
}

/** Rango ISO que cubre entero un mes "YYYY_MM", para enlazar al catalogo filtrado. */
export function monthKeyToRange(
  key: string,
): { from: string; to: string } | null {
  const match = /^(\d{4})_(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return {
    from: `${year}-${pad(month)}-01`,
    to: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}
