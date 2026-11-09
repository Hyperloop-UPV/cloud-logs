// Las trazas de fondo del acceso, sobre canvas.
//
// Toda la geometria vive en signInTrace.ts, que es puro y verificable en Node.
// Aqui solo queda lo que necesita el navegador: medir, pintar, animar y parar.

import { useEffect, useRef, useState } from "react";
import { readThemeColors } from "../constants/chartConfig";
import { CHANNELS, sampleCount, tracePoints } from "./signInTrace";

/** Opacidad de cada traza. La de marca destaca; las demas son casi fondo. */
const BRAND_ALPHA = 0.5;
const PLAIN_ALPHA = 0.16;
const LINE_WIDTH = 1.5;

export function TelemetryTrace() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [colors, setColors] = useState(readThemeColors);

  // El canvas no hereda CSS, asi que los colores se leen de las variables. Y se
  // vigila la clase de documentElement en vez de recibir un prop: los efectos de
  // los hijos corren antes que los de los padres, de modo que un prop llegaria
  // con el tema anterior. Ya costo una iteracion en el grafo.
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(readThemeColors()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Quien pide menos movimiento recibe un fotograma y nada mas. No es un
    // adorno opcional: una onda recorriendo el fondo es justo lo que molesta.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let frame = 0;
    let elapsed = 0;
    let last = 0;

    const draw = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = LINE_WIDTH;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      const samples = sampleCount(width);

      for (const channel of CHANNELS) {
        const points = tracePoints(width, height, time, channel, samples);
        // Lista vacia = tamaño degenerado. Se salta en vez de pintar NaN, que no
        // da error y deja el lienzo a medias.
        if (points.length === 0) continue;

        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++)
          ctx.lineTo(points[i].x, points[i].y);

        ctx.strokeStyle = channel.brand ? colors.accent : colors.text;
        ctx.globalAlpha = channel.brand ? BRAND_ALPHA : PLAIN_ALPHA;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const tick = (now: number) => {
      // El tiempo solo avanza mientras se esta viendo: asi la onda no pega un
      // salto al volver a la pestaña, y entretanto no se gasta nada.
      if (last) elapsed += (now - last) / 1000;
      last = now;
      draw(elapsed);
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      if (still || frame) return;
      last = 0;
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = 0;
    };

    // El dibujo se mide en pixeles CSS y se escala al ratio del dispositivo: sin
    // esto el trazo de 1.5 px sale borroso en pantallas densas.
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw(elapsed);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) start();

    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [colors]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      // La mascara abre un claro en el centro, donde va la columna: el texto
      // conserva su contraste y las trazas se van a los lados, sangrando por los
      // bordes. Es lo que la separa de parecer un grafico con su marco.
      style={{
        maskImage:
          "radial-gradient(ellipse 42% 46% at 50% 50%, transparent 35%, black 100%)",
        WebkitMaskImage:
          "radial-gradient(ellipse 42% 46% at 50% 50%, transparent 35%, black 100%)",
      }}
    />
  );
}
