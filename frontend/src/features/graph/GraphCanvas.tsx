// Grafo del archivo, al estilo del de Obsidian.
//
// **Un nodo por log y un nodo por etiqueta**, unidos cuando el log lleva esa
// etiqueta. Es el mismo reparto que hace Obsidian con notas y tags: los logs se
// agrupan solos alrededor de las etiquetas que comparten, y las que se usan juntas
// quedan cerca porque tiran de los mismos logs. No hay aristas log-log: con N logs
// serian N² lineas y el dibujo no diria nada.
//
// Lo pinta react-force-graph-2d (d3-force sobre canvas), que trae hechos el
// arrastre, el zoom y el desplazamiento.
//
// **El area del nodo es proporcional al tamaño del fichero**, que es la
// codificacion honesta: el ojo compara manchas, no radios. Se probo tambien una
// escala logaritmica pensando que el rango de tamaños lo exigiria, y con los datos
// reales resulto peor —apelotonaba el 60% de los logs en el tramo mas grande,
// frente al 32% del area—. Si algun dia los tamaños abarcan de veras varios
// ordenes de magnitud, habra que volver a medirlo antes de cambiarlo.
//
// **Color**: los logs toman el de su estado, del mapa unico de statusStyles —asi el
// grafo respeta la convencion de que el color saturado significa estado, y un log
// fallido se ve a la primera—. Las etiquetas van en el naranja de marca, que es lo
// que las distingue como otra clase de nodo.
//
// Tres cosas que hay que respetar al tocar esto:
//
// 1. **graphData tiene que ser referencialmente estable.** La libreria guarda la
//    posicion y la velocidad dentro de los propios objetos de nodo; un objeto nuevo
//    en cada render reinicia la simulacion y el grafo tiembla.
// 2. **El canvas no hereda CSS.** Los colores salen de readThemeColors(), releidos
//    con un MutationObserver sobre la clase de documentElement.
// 3. **El texto se pinta dividiendo por la escala**, o crece como un globo al
//    acercar el zoom.

import { Maximize2, Minimize2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { ForceGraphMethods } from "react-force-graph-2d";
import type { Log } from "../../api/types";
import { readThemeColors } from "../../constants/chartConfig";
import { statusStyle } from "../catalog/statusStyles";
import { formatBytes, formatCount } from "../../lib/format";
import type { TagAggregate } from "../tags/useTagAggregate";

interface GraphNode {
  id: string;
  kind: "log" | "tag";
  label: string;
  radius: number;
  color: string;
  /** Texto del tooltip, ya compuesto. */
  title: string;
  /** Solo en los nodos de log: para abrir su ficha. */
  logId?: string;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string;
  target: string;
}

/**
 * Alto de partida del lienzo, solo hasta que el ResizeObserver mide de verdad.
 *
 * No es "el alto del grafo": el grafo ocupa el alto que le quede a la seccion.
 * Esto es la semilla para el primer render, antes de que haya nada que medir.
 */
const INITIAL_HEIGHT = 560;

// Rangos de radio. Los logs son la masa del dibujo y van pequeños; las etiquetas
// son los puntos de anclaje y van mayores.
//
// TAG_MIN_R tiene que quedar **por encima de LOG_MAX_R**: si la etiqueta mas
// pequeña puede ser menor que el log mas grande, la jerarquia se invierte y un
// fichero gordo parece un punto de anclaje. Es un invariante, no una preferencia.
const LOG_MIN_R = 1.8;
const LOG_MAX_R = 8;
const TAG_MIN_R = 10;
const TAG_MAX_R = 17;

/** Tope de nodos de log; por encima el grafo deja de leerse y de ir fluido. */
const MAX_LOG_NODES = 600;

/** Cuanto se aclara el acento para teñir los vecinos. */
const TINT = 0.45;

/**
 * El color mezclado con blanco, para un tono mas claro del mismo.
 *
 * Se mezcla hacia **blanco** y no hacia el fondo a proposito: hacia el fondo
 * saldria mas claro en el tema claro pero mas *oscuro* en el oscuro, y lo que se
 * quiere es el mismo color mas palido en los dos.
 *
 * Las variables del kit son hex, pero un tema podria declarar `oklch()` o
 * `rgb()`. Si no se puede leer se devuelve el color tal cual: asignar una cadena
 * invalida a `fillStyle` no da error, el canvas **se queda con el color anterior
 * sin avisar**, y un fallo asi seria invisible.
 */
function lighten(color: string, amount: number): string {
  const hex = color.trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) return color;
  const d = m[1];
  const full =
    d.length === 3
      ? d
          .split("")
          .map((c) => c + c)
          .join("")
      : d;
  const channel = (i: number) => {
    const v = parseInt(full.slice(i * 2, i * 2 + 2), 16);
    return Math.round(v + (255 - v) * amount);
  };
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

/**
 * Radio cuya **area** es proporcional al valor.
 *
 * `r = rMax * sqrt(v / vMax)`, con un suelo para que lo diminuto siga siendo
 * visible y clicable. El suelo rompe un poco la proporcionalidad en la cola
 * baja; es el precio de que un log de unos megas no sea un pixel invisible.
 */
function areaScale(
  value: number,
  maxValue: number,
  rMin: number,
  rMax: number,
): number {
  if (!(maxValue > 0)) return (rMin + rMax) / 2;
  return Math.max(rMin, rMax * Math.sqrt(Math.max(value, 0) / maxValue));
}

function endId(end: unknown): string {
  if (typeof end === "string") return end;
  if (end && typeof end === "object" && "id" in end)
    return String((end as { id: unknown }).id);
  return "";
}

export function GraphCanvas({
  tags,
  logs,
  onPickTag,
  onPickLog,
}: {
  tags: TagAggregate[];
  logs: Log[];
  onPickTag: (tag: string) => void;
  onPickLog: (logId: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(
    undefined,
  );
  const [size, setSize] = useState({ width: 900, height: INITIAL_HEIGHT });
  const [isFull, setIsFull] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [colors, setColors] = useState(readThemeColors);

  // La clase .dark la pone un efecto de un componente antecesor, y los efectos de
  // los hijos corren antes que los de los padres: mirando un prop isDark se
  // leerian los colores del tema anterior. Por eso se vigila el atributo.
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(readThemeColors()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  // Se mide la caja del grafo, no el contenedor de la pagina: en pantalla
  // completa el alto deja de ser fijo y pasa a ser el que quede.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(320, Math.round(entry.contentRect.width));
      const height = Math.max(240, Math.round(entry.contentRect.height));
      setSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // Pantalla completa. El navegador puede salir solo (Escape, o el usuario desde
  // el sistema), asi que el estado se sincroniza con el evento y no al pulsar:
  // de lo contrario el boton acabaria mintiendo.
  useEffect(() => {
    const onChange = () =>
      setIsFull(document.fullscreenElement === hostRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    // Puede rechazarse (un iframe sin permiso, o una politica del navegador):
    // no se deja escapar la promesa.
    void hostRef.current?.requestFullscreen().catch(() => undefined);
  }, []);

  // Al entrar o salir hay que reencuadrar: el lienzo cambia de tamaño y el grafo
  // se queda descentrado. El retardo deja que el navegador termine la transicion.
  useEffect(() => {
    const id = window.setTimeout(
      () => graphRef.current?.zoomToFit(500, 40),
      250,
    );
    return () => window.clearTimeout(id);
  }, [isFull]);

  // Solo los logs con alguna etiqueta: uno suelto seria un punto a la deriva.
  const shown = useMemo(
    () => logs.filter((log) => log.tags.length > 0).slice(0, MAX_LOG_NODES),
    [logs],
  );
  const omitted =
    logs.filter((log) => log.tags.length > 0).length - shown.length;

  // Referencialmente estable: la libreria escribe x/y/vx/vy aqui dentro.
  const graphData = useMemo(() => {
    const maxSize = shown.reduce((m, log) => Math.max(m, log.fileSize ?? 0), 0);
    const maxCount = tags.reduce((m, t) => Math.max(m, t.logs), 0);

    const present = new Set(shown.flatMap((log) => log.tags));
    const nodes: GraphNode[] = [
      ...tags
        .filter((entry) => present.has(entry.tag))
        .map((entry) => ({
          id: `tag:${entry.tag}`,
          kind: "tag" as const,
          label: entry.tag,
          radius: areaScale(entry.logs, maxCount, TAG_MIN_R, TAG_MAX_R),
          color: colors.accent,
          title: `${entry.tag} — ${formatCount(entry.logs)} logs, ${formatBytes(entry.bytes)}`,
        })),
      ...shown.map((log) => ({
        id: `log:${log.id}`,
        kind: "log" as const,
        label: log.fileName,
        radius: areaScale(log.fileSize ?? 0, maxSize, LOG_MIN_R, LOG_MAX_R),
        color: statusStyle(log.status).canvasColor,
        title: `${log.fileName} — ${formatBytes(log.fileSize)} · ${statusStyle(log.status).label}`,
        logId: log.id,
      })),
    ];

    const links: GraphLink[] = shown.flatMap((log) =>
      [...new Set(log.tags)]
        .filter((tag) => present.has(tag))
        .map((tag) => ({ source: `log:${log.id}`, target: `tag:${tag}` })),
    );

    return { nodes, links };
  }, [shown, tags, colors.accent]);

  /**
   * Vecindario del nodo señalado: el propio nodo y los que estan a una arista.
   *
   * **Los extremos hay que leerlos con endId().** d3-force sustituye en el sitio
   * las cadenas source/target por los objetos de nodo en el primer tick, asi que
   * comparar `link.source === hovered` da siempre falso en cuanto la simulacion
   * arranca. Eso dejaba el conjunto con un solo elemento y los vecinos, en vez de
   * resaltarse, caian en la rama de atenuado: se apagaban.
   */
  const neighbours = useMemo(() => {
    if (!hovered) return null;
    const set = new Set<string>([hovered]);
    for (const link of graphData.links) {
      const source = endId(link.source);
      const target = endId(link.target);
      if (source === hovered) set.add(target);
      if (target === hovered) set.add(source);
    }
    return set;
  }, [hovered, graphData]);

  // Las etiquetas tienen que separarse mas: son los anclajes y acumulan muchos
  // logs alrededor. Sin esto, los racimos se montan unos sobre otros.
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph
      .d3Force("charge")
      ?.strength((node: GraphNode) => (node.kind === "tag" ? -380 : -38));
    // Enlaces mas largos y mas blandos: el racimo respira en lugar de quedar
    // apelmazado, y los nodos llegan a su sitio deslizandose, no de un tiron.
    graph.d3Force("link")?.distance(60).strength(0.18);
  }, [graphData]);

  // Se calcula una vez por tema, no en cada nodo de cada fotograma.
  const tint = useMemo(() => lighten(colors.accent, TINT), [colors.accent]);

  const paintNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const dim = neighbours !== null && !neighbours.has(node.id);
      const active = hovered === node.id;
      // Vecino del señalado: al apuntar una etiqueta, sus logs. No basta con
      // apagar lo demas —quedaria la duda de si un nodo luce porque pertenece o
      // porque esta cerca—, asi que se marcan de forma positiva.
      const related = !dim && !active && hovered !== null;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const isTag = node.kind === "tag";

      ctx.beginPath();
      ctx.arc(x, y, node.radius, 0, 2 * Math.PI);
      // Los vecinos a una arista se tiñen del acento, mas claro. Solo los logs:
      // una etiqueta ya va de ese color, y aclararla la haria parecer apagada
      // justo cuando se la esta señalando.
      ctx.fillStyle = related && !isTag ? tint : node.color;
      ctx.globalAlpha = dim
        ? 0.08
        : active
          ? 1
          : related
            ? 0.95
            : isTag
              ? 0.9
              : 0.7;
      ctx.fill();

      // El relleno naranja tapa el color de estado, que es informacion, asi que
      // el estado pasa al borde en vez de perderse.
      if (related) {
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 1.6 / scale;
        ctx.strokeStyle = isTag ? colors.accent : node.color;
        ctx.stroke();
      } else if (active || (isTag && !dim)) {
        ctx.globalAlpha = dim ? 0.15 : 1;
        ctx.lineWidth = (active ? 2.2 : 1) / scale;
        ctx.strokeStyle = active ? colors.accent : node.color;
        ctx.stroke();
      }

      // Las etiquetas se rotulan siempre que el zoom lo permita; los nombres de
      // fichero son largos y solo salen al señalarlos.
      const label = isTag ? node.label : active ? node.label : null;
      if (!label || (isTag && !active && node.radius * scale < 8)) {
        ctx.globalAlpha = 1;
        return;
      }

      const fontSize = (isTag ? 11 : 10) / scale;
      ctx.font = `${active || isTag ? 600 : 500} ${fontSize}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const ty = y + node.radius + 3 / scale;

      // Caja detras del texto: sobre un racimo denso, sin ella no se lee nada.
      if (active || related) {
        const w = ctx.measureText(label).width;
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = colors.background;
        ctx.fillRect(
          x - w / 2 - 2 / scale,
          ty - 1 / scale,
          w + 4 / scale,
          fontSize + 2 / scale,
        );
      }

      ctx.globalAlpha = dim ? 0.2 : 1;
      ctx.fillStyle =
        active || related
          ? colors.accent
          : isTag
            ? colors.foreground
            : colors.text;
      ctx.fillText(label, x, ty);
      ctx.globalAlpha = 1;
    },
    [colors, hovered, neighbours, tint],
  );

  return (
    <div
      ref={hostRef}
      // En pantalla completa este nodo es la raiz, asi que necesita fondo propio
      // y ocupar el alto entero; fuera de ella solo envuelve.
      //
      // El relleno va a los cuatro lados. Estuvo en px-4 pb-4 y el lienzo quedaba
      // pegado a la cabecera con 16 px en los otros tres: el canal de arriba se
      // ve raro justo porque los demas si estan.
      className={
        isFull
          ? "bg-background flex h-full w-full flex-col p-4"
          : "flex min-h-0 w-full flex-1 flex-col p-4"
      }
    >
      <div
        ref={boxRef}
        className="bg-muted/20 relative min-h-0 flex-1 overflow-hidden rounded-xl border"
      >
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={isFull ? "Exit full screen" : "Full screen"}
          title={isFull ? "Exit full screen  (Esc)" : "Full screen"}
          className="bg-background/80 text-muted-foreground hover:text-foreground absolute top-2 right-2 z-10 rounded-md border p-1.5 backdrop-blur transition-colors"
        >
          {isFull ? (
            <Minimize2 className="size-3.5" />
          ) : (
            <Maximize2 className="size-3.5" />
          )}
        </button>

        <ForceGraph2D<GraphNode, GraphLink>
          ref={graphRef}
          graphData={graphData}
          width={size.width}
          height={size.height}
          backgroundColor="transparent"
          nodeRelSize={1}
          nodeVal={(node) => node.radius * node.radius}
          nodeLabel={(node) => node.title}
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={(node, color, ctx) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            // Area de impacto algo mayor que el circulo: con nodos pequeños,
            // acertar exactamente encima es incomodo.
            ctx.arc(node.x ?? 0, node.y ?? 0, node.radius + 3, 0, 2 * Math.PI);
            ctx.fill();
          }}
          linkColor={(link) => {
            if (
              hovered &&
              (endId(link.source) === hovered || endId(link.target) === hovered)
            )
              return colors.accent;
            return colors.grid;
          }}
          // Mas gordas de lo que pide la legibilidad estricta: con nodos pequeños
          // las lineas son lo que da cuerpo al dibujo, y a 0.4 px se perdian.
          linkWidth={(link) =>
            hovered &&
            (endId(link.source) === hovered || endId(link.target) === hovered)
              ? 2.6
              : 1.2
          }
          onNodeHover={(node) => setHovered(node ? node.id : null)}
          onNodeClick={(node) =>
            node.kind === "tag"
              ? onPickTag(node.label)
              : node.logId && onPickLog(node.logId)
          }
          onBackgroundClick={() => setHovered(null)}
          // --- El "fluir" ---
          // Antes se congelaba a los 160 ticks y el grafo quedaba rigido. Ahora:
          //  · warmupTicks: arranca ya ordenado, sin la explosion inicial.
          //  · d3AlphaDecay bajo: se enfria despacio, los nodos se deslizan a su
          //    sitio en vez de llegar de un tiron.
          //  · d3VelocityDecay bajo: conservan inercia, que es lo que da la
          //    sensacion de peso y de flotar.
          //  · cooldownTime generoso: sigue moviendose un rato antes de parar.
          // Arrastrar un nodo recalienta la simulacion por si solo.
          warmupTicks={40}
          cooldownTime={20000}
          d3AlphaDecay={0.008}
          d3VelocityDecay={0.22}
          onEngineStop={() => graphRef.current?.zoomToFit(500, 40)}
          enableNodeDrag
        />
      </div>

      <p className="text-muted-foreground mt-2 shrink-0 text-[11px]">
        Every log is a node, joined to each tag it carries. Log nodes take the
        colour of their status, and their area is proportional to file size;
        tags are the larger accent nodes. Hover a tag to pick out its logs, drag
        to rearrange, scroll to zoom. Click a log to open it, a tag to filter
        the catalog.
        {omitted > 0 &&
          ` Showing ${formatCount(shown.length)} logs; ${formatCount(omitted)} more are not drawn.`}
      </p>
    </div>
  );
}
