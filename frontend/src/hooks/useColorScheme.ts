// Modo claro/oscuro.
//
// El valor inicial lo da el sistema (prefers-color-scheme) y a partir de ahi manda
// la eleccion del usuario, persistida. El kit define su variante oscura como
// `&:is(.dark *)`, es decir descendiente de .dark, por eso la clase va en
// documentElement y no en el body.

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "cloud-logs-dark-mode";

function initialIsDark(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) return saved === "true";
  } catch {
    // Modo privado o almacenamiento bloqueado: se cae al criterio del sistema.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function useColorScheme() {
  const [isDark, setIsDark] = useState(initialIsDark);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    try {
      localStorage.setItem(STORAGE_KEY, String(isDark));
    } catch {
      // La preferencia no sobrevivira a la recarga, pero la sesion actual funciona.
    }
  }, [isDark]);

  const toggle = useCallback(() => setIsDark((prev) => !prev), []);

  return { isDark, toggle };
}
