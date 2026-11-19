// Formateadores de presentacion. El kit no trae ninguno.
//
// Convencion de la familia: una celda sin valor se pinta con una raya (—), nunca
// con cadena vacia ni "N/A".

export const EMPTY = "—";

/** Tamano de archivo legible. Base 1024, porque el API cuenta bytes reales. */
export function formatBytes(bytes: number | null | undefined): string {
  if (
    bytes === null ||
    bytes === undefined ||
    bytes < 0 ||
    Number.isNaN(bytes)
  ) {
    return EMPTY;
  }
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

  let deltaSeconds = (date.getTime() - Date.now()) / 1000;
  for (const division of DIVISIONS) {
    if (Math.abs(deltaSeconds) < division.amount) {
      return relative.format(Math.round(deltaSeconds), division.unit);
    }
    deltaSeconds /= division.amount;
  }
  return formatDate(iso);
}

export const formatRelativeTime = formatRelative;

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
