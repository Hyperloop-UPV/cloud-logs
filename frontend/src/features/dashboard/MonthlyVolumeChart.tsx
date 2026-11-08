// Volumen de logs por mes, con uPlot, como competition-view.
//
// Los datos salen de stats.byFolder, que el API devuelve agrupado por la carpeta
// mensual de Drive ("2026_10"): es un histograma ya hecho.
//
// Dos cosas que uPlot obliga a resolver a mano, porque pinta en canvas:
//
// 1. No se adapta solo. El tamano va en pixeles, asi que hace falta un
//    ResizeObserver que lo redimensione cuando cambia el ancho del contenedor.
// 2. No hereda el CSS. Los colores van dentro de las opciones, de modo que al
//    cambiar de tema hay que reconstruir la grafica entera; por eso `isDark` esta
//    entre las dependencias del efecto.

import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import {
  CHART_COLORS,
  CHART_HEIGHT,
  formatAxisValue,
  readThemeColors,
} from "../../constants/chartConfig";
import { formatMonthKey, monthKeyToRange } from "../../lib/format";

interface MonthlyVolumeChartProps {
  byFolder: Record<string, number>;
  isDark: boolean;
}

export function MonthlyVolumeChart({
  byFolder,
  isDark,
}: MonthlyVolumeChartProps) {
  const holder = useRef<HTMLDivElement | null>(null);
  const chart = useRef<uPlot | null>(null);
  const navigate = useNavigate();

  // Las claves "YYYY_MM" ordenan bien como texto, asi que basta con ordenarlas.
  const months = useMemo(
    () => Object.keys(byFolder).sort((a, b) => a.localeCompare(b)),
    [byFolder],
  );
  const counts = useMemo(
    () => months.map((key) => byFolder[key] ?? 0),
    [months, byFolder],
  );

  // El click se resuelve contra una ref para no reconstruir la grafica entera cada
  // vez que cambie la funcion de navegacion. Se asigna en un efecto y no en el
  // render: tocar una ref mientras se renderiza es justo lo que React desaconseja.
  const onBarClick = useRef<(index: number) => void>(() => {});
  useEffect(() => {
    onBarClick.current = (index: number) => {
      const key = months[index];
      if (!key) return;
      const range = monthKeyToRange(key);
      if (!range) return;
      navigate(`/catalog?from=${range.from}&to=${range.to}`);
    };
  });

  useEffect(() => {
    const element = holder.current;
    if (!element || months.length === 0) return;

    const theme = readThemeColors();
    const labels = months.map(formatMonthKey);
    const bars = uPlot.paths.bars?.({ size: [0.62, 36] });

    const options: uPlot.Options = {
      width: element.clientWidth || 600,
      height: CHART_HEIGHT,
      padding: [8, 8, 0, 0],
      legend: { show: false },
      cursor: { y: false, points: { show: false } },
      scales: {
        // Media unidad de margen a cada lado para que la primera y la ultima barra
        // no queden cortadas por el borde del lienzo.
        x: { time: false, range: () => [-0.5, months.length - 0.5] },
        y: { range: (_u, _min, max) => [0, Math.max(1, max)] },
      },
      axes: [
        {
          stroke: theme.text,
          grid: { show: false },
          ticks: { show: false },
          font: "10px Archivo, sans-serif",
          splits: () => months.map((_, i) => i),
          values: (_u, splits) => splits.map((i) => labels[i] ?? ""),
        },
        {
          stroke: theme.text,
          grid: { stroke: theme.grid, width: 1 },
          ticks: { show: false },
          font: "10px Archivo, sans-serif",
          size: 40,
          values: (_u, splits) => splits.map(formatAxisValue),
        },
      ],
      series: [
        { label: "Month" },
        {
          label: "Logs",
          paths: bars,
          stroke: CHART_COLORS[0],
          fill: CHART_COLORS[0],
          width: 0,
          points: { show: false },
        },
      ],
      hooks: {
        // uPlot no expone un evento de click por barra: se toma el indice mas
        // cercano al cursor, que es el que esta resaltado en ese momento.
        ready: [
          (u) => {
            u.over.style.cursor = "pointer";
            u.over.addEventListener("click", () => {
              const index = u.cursor.idx;
              if (index !== null && index !== undefined) {
                onBarClick.current(index);
              }
            });
          },
        ],
      },
    };

    const instance = new uPlot(
      options,
      [months.map((_, i) => i), counts],
      element,
    );
    chart.current = instance;

    const observer = new ResizeObserver(([entry]) => {
      instance.setSize({
        width: Math.max(1, Math.floor(entry.contentRect.width)),
        height: CHART_HEIGHT,
      });
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
      instance.destroy();
      chart.current = null;
    };
    // isDark reconstruye la grafica: los colores viven dentro de las opciones.
  }, [months, counts, isDark]);

  if (months.length === 0) {
    return (
      <p className="text-muted-foreground py-10 text-center text-xs">
        No uploads recorded yet.
      </p>
    );
  }

  return <div ref={holder} className="w-full" />;
}
