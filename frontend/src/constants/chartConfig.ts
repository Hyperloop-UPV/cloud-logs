// Configuracion de graficas, calcada de competition-view/src/constants/chartConfig.ts
// para que una barra aqui y una serie alli se vean de la misma familia.

/** Paleta de series: el naranja de marca primero, como en competition-view. */
export const CHART_COLORS = [
  "#ff7f24", // primary orange
  "#2563eb", // blue
  "#10b981", // green
  "#ef4444", // red
  "#8b5cf6", // purple
] as const;

/** Alto por defecto de una grafica, en pixeles. */
export const CHART_HEIGHT = 180;

const compactFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 2,
});

/**
 * Formatea el valor de una marca de eje, corto para que uPlot no lo descarte por
 * falta de sitio.
 */
export const formatAxisValue = (value: number): string => {
  if (!Number.isFinite(value)) return "";
  return compactFormatter.format(value);
};

/**
 * Lee del CSS los colores del tema en curso.
 *
 * uPlot pinta en canvas, asi que no hereda nada de la hoja de estilos: hay que
 * pasarle colores resueltos. Leerlos de las variables del kit en vez de escribirlos
 * a mano es lo que hace que la grafica siga al tema claro/oscuro.
 */
export function readThemeColors(): {
  grid: string;
  axis: string;
  text: string;
  /** Relleno de un nodo en reposo. */
  node: string;
  /** Nodo y aristas resaltados: el naranja de marca. */
  accent: string;
  /** Texto principal, para las etiquetas sobre el lienzo. */
  foreground: string;
  background: string;
} {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    grid: read("--border", "#e4e4e7"),
    axis: read("--border", "#e4e4e7"),
    text: read("--muted-foreground", "#71717a"),
    node: read("--muted-foreground", "#71717a"),
    accent: read("--primary", CHART_COLORS[0]),
    foreground: read("--foreground", "#18181b"),
    background: read("--background", "#ffffff"),
  };
}
