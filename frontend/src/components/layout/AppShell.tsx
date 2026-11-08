// Shell canonico de la familia: altura del header como variable CSS en el contenedor
// raiz, SidebarProvider, y el contenido como unica zona con scroll.
//
// Copiado de competition-view/src/layout/AppLayout.tsx para que la app se mueva igual
// que el resto de las vistas (Ctrl/Cmd+B colapsa el rail, el estado persiste en la
// cookie sidebar_state).
//
// Las metricas se consultan aqui, una sola vez, y alimentan los contadores del rail;
// react-query las comparte con el dashboard sin pedirlas dos veces.

import {
  SidebarInset,
  SidebarProvider,
} from "@hyperloopupv/frontend-kit/components";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getStats } from "../../api/endpoints";
import { useColorScheme } from "../../hooks/useColorScheme";
import { AppSidebar } from "./AppSidebar";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp";

export function AppShell({ children }: { children: ReactNode }) {
  const { isDark, toggle } = useColorScheme();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const stats = useQuery({ queryKey: ["logStats"], queryFn: getStats });

  // "?" abre la hoja de atajos. Se ignora mientras se escribe en un campo, donde la
  // tecla es texto y no un comando.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "?" || event.metaKey || event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable)
        return;
      event.preventDefault();
      setShortcutsOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const byStatus = stats.data?.byStatus;
  const counts = {
    "/catalog": stats.data?.totalLogs,
    // En "Upload" interesa lo que se quedo a medias: son las subidas que alguien
    // tiene que terminar o abortar.
    "/upload": byStatus
      ? (byStatus.pending_upload ?? 0) + (byStatus.failed ?? 0)
      : undefined,
  };

  return (
    // SidebarProvider ya es el contenedor flex; envolverlo en otro div flex sobraba.
    <div className="h-full w-full [--header-height:calc(--spacing(14))]">
      <SidebarProvider className="bg-background h-full w-full">
        <AppSidebar
          isDark={isDark}
          onToggleTheme={toggle}
          onShowShortcuts={() => setShortcutsOpen(true)}
          counts={counts}
        />
        <SidebarInset className="flex h-full min-w-0 flex-col">
          {children}
        </SidebarInset>
        <KeyboardShortcutsHelp
          open={shortcutsOpen}
          onOpenChange={setShortcutsOpen}
        />
      </SidebarProvider>
    </div>
  );
}
