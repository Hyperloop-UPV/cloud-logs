// Modo claro/oscuro, compartido por toda la aplicacion.
//
// El valor inicial lo da el sistema (prefers-color-scheme) y a partir de ahi manda
// la eleccion del usuario, persistida. El kit define su variante oscura como
// `&:is(.dark *)`, es decir descendiente de .dark, por eso la clase va en
// documentElement y no en el body.
//
// Dos decisiones que parecen rebuscadas y no lo son — cada una arregla un fallo
// que ya estaba vivo:
//
// 1. **El estado vive fuera de React, en el modulo.** Antes cada llamada al hook
//    creaba su propio `useState`. `AppShell` y `DashboardPage` llaman los dos, de
//    modo que conmutar desde el rail cambiaba el estado de `AppShell` y el del
//    dashboard se quedaba con el valor viejo; su grafica, que se reconstruye
//    cuando cambia `isDark`, seguia pintada con los colores del tema anterior.
//    Un tema es una preferencia global: tiene que haber un solo valor, lo llamen
//    dos componentes o diez.
//
// 2. **La clase se aplica en el setter, no en un efecto.** Los efectos de los
//    hijos corren antes que los de los padres, asi que con un efecto quien leyera
//    las variables CSS al reaccionar al cambio —`MonthlyVolumeChart` lo hace con
//    `readThemeColors()`— las leeria del tema anterior. Poniendola en la accion,
//    el DOM ya esta actualizado antes de que nada vuelva a renderizar, y el
//    problema de orden desaparece en vez de esquivarse.

import { useCallback, useSyncExternalStore } from "react";

// **Duplicada en index.html**, en el script que aplica el tema antes del primer
// pintado. Tiene que ir aqui tambien porque ese script no puede importar nada: va
// bloqueante en la cabecera, antes del bundle. Si cambias la clave o el criterio,
// cambialo en los dos sitios o aparecera un destello del tema contrario.
const STORAGE_KEY = "cloud-logs-dark-mode";

/** Hay DOM? Permite cargar el modulo en Node para verificarlo. */
const hasDom = typeof document !== "undefined";

function initialIsDark(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) return saved === "true";
  } catch {
    // Modo privado o almacenamiento bloqueado: se cae al criterio del sistema.
  }
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

let current = hasDom ? initialIsDark() : false;
const listeners = new Set<() => void>();

/** Deja el DOM y el almacenamiento al dia. Idempotente. */
function apply(next: boolean): void {
  current = next;
  if (hasDom) document.documentElement.classList.toggle("dark", next);
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    // La preferencia no sobrevivira a la recarga, pero la sesion actual funciona.
  }
}

// Se aplica al cargar el modulo, no al montar un componente: asi la clase esta
// puesta antes del primer pintado y no se ve el destello del tema contrario.
if (hasDom) apply(current);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return current;
}

/**
 * Fija el tema.
 *
 * Se exporta ademas de `toggle` porque es la operacion de escritura del almacen,
 * y porque permite ejercitar el modulo sin React al verificarlo.
 */
export function setColorScheme(next: boolean): void {
  if (next === current) return;
  // El orden importa: primero el DOM, despues avisar. Quien reaccione al aviso
  // tiene que encontrarse las variables CSS ya cambiadas.
  apply(next);
  for (const listener of [...listeners]) listener();
}

export function useColorScheme() {
  const isDark = useSyncExternalStore(subscribe, getSnapshot);
  const toggle = useCallback(() => setColorScheme(!current), []);
  return { isDark, toggle };
}
