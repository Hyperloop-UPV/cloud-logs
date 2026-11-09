// Generador de las trazas de fondo del acceso.
//
// **Esto no es un grafico y no pretende serlo.** No dibuja datos: es una forma de
// onda sintetica, de ambiente. Por eso la pantalla no le pone ejes, ni valores, ni
// rejilla, ni leyenda, y la deja sangrar por los dos bordes. Si alguna vez se le
// añade cualquiera de esas cosas, empezara a parecer una lectura real del pod y
// dejara de ser honesta.
//
// Va aparte del componente y **sin React ni DOM** a proposito: siendo una funcion
// pura se ejecuta en Node y se puede afirmar sobre la geometria sin abrir un
// navegador. Es el mismo recurso que hizo verificable el grafo.

export interface TracePoint {
  x: number;
  y: number;
}

export interface Channel {
  /** Amplitud, como fraccion del alto. */
  amplitude: number;
  /** Ciclos completos a lo ancho del lienzo. */
  frequency: number;
  /** Desplazamiento horizontal por segundo, en ciclos. */
  speed: number;
  /** Desfase inicial, para que los canales no arranquen alineados. */
  phase: number;
  /** Altura de reposo, como fraccion del alto (0 arriba, 1 abajo). */
  centre: number;
  /** El canal de marca. Solo uno lo lleva. */
  brand?: boolean;
}

const TAU = Math.PI * 2;

/**
 * Los canales.
 *
 * Las frecuencias son **inconmensurables entre si** (3.1, 5.7, 2.3…): si fueran
 * multiplos, las trazas se cruzarian siempre en los mismos puntos y el conjunto se
 * leeria como un patron repetido en vez de como señales independientes.
 *
 * **Solo uno es de marca.** La convencion del proyecto es que el color saturado
 * significa estado; el naranja se reserva para la marca y la accion primaria, y
 * una sola traza de marca se lee como marca y no como una medida.
 */
export const CHANNELS: Channel[] = [
  {
    amplitude: 0.26,
    frequency: 3.1,
    speed: 0.05,
    phase: 0,
    centre: 0.5,
    brand: true,
  },
  { amplitude: 0.18, frequency: 5.7, speed: -0.08, phase: 1.7, centre: 0.42 },
  { amplitude: 0.3, frequency: 2.3, speed: 0.03, phase: 3.4, centre: 0.58 },
  { amplitude: 0.12, frequency: 8.9, speed: -0.12, phase: 5.2, centre: 0.47 },
  { amplitude: 0.22, frequency: 1.7, speed: 0.07, phase: 2.1, centre: 0.54 },
];

/**
 * La forma de onda: cuatro senos sumados.
 *
 * Un seno solo se ve como una onda de libro de texto. Sumando armonicos que no
 * encajan entre si aparecen crestas desiguales y tramos casi planos, que es lo que
 * hace que se lea como una señal.
 *
 * Los pesos suman **exactamente 1**, asi que el resultado esta acotado en [-1, 1]
 * sin necesidad de recortarlo. Si se tocan, hay que mantener esa suma o la
 * amplitud dejara de significar lo que dice.
 */
function waveform(t: number): number {
  return (
    Math.sin(t) * 0.6 +
    Math.sin(t * 2.3 + 1.1) * 0.25 +
    Math.sin(t * 5.1 + 2.7) * 0.1 +
    Math.sin(t * 9.7 + 0.4) * 0.05
  );
}

/**
 * Los puntos de una traza, de izquierda a derecha.
 *
 * `time` va en segundos. Devuelve lista vacia ante tamaños degenerados en vez de
 * puntos con NaN: un `fillStyle` invalido o un `lineTo(NaN)` no dan error, dejan el
 * lienzo a medio pintar sin avisar.
 */
export function tracePoints(
  width: number,
  height: number,
  time: number,
  channel: Channel,
  samples: number,
): TracePoint[] {
  if (!(width > 0) || !(height > 0) || samples < 2) return [];

  const points: TracePoint[] = [];
  const half = (channel.amplitude * height) / 2;
  const centre = channel.centre * height;

  for (let i = 0; i < samples; i++) {
    const progress = i / (samples - 1);
    const angle =
      channel.phase +
      progress * channel.frequency * TAU +
      time * channel.speed * TAU;
    const y = centre + waveform(angle) * half;
    points.push({
      x: progress * width,
      // El recorte es una red de seguridad, no la regla: con los centros y
      // amplitudes de CHANNELS ninguna traza llega a los bordes. Protege de que
      // alguien ajuste una amplitud y se salga del lienzo sin darse cuenta.
      y: Math.min(height, Math.max(0, y)),
    });
  }
  return points;
}

/** Cuantos puntos merece la pena calcular para un ancho dado. */
export function sampleCount(width: number): number {
  // Un punto cada 6 px: por debajo se ven los segmentos, por encima se gasta
  // tiempo en detalle que el trazo de 1.5 px no puede mostrar.
  return Math.max(2, Math.min(400, Math.ceil(width / 6)));
}
