// Barra superior de una pagina: toggle del rail, titulo y acciones a la derecha.
//
// La altura sale de --header-height, declarada en AppShell, para que coincida con
// la del resto de las vistas del equipo.

import {
  Separator,
  SidebarTrigger,
} from "@hyperloopupv/frontend-kit/components";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  /** Linea secundaria: recuento, estado de la consulta, contexto. */
  meta?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, meta, actions }: PageHeaderProps) {
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator
        orientation="vertical"
        className="mr-1 data-[orientation=vertical]:h-4"
      />
      <h1 className="text-foreground shrink-0 text-xl font-bold">{title}</h1>
      {meta && <div className="min-w-0 truncate">{meta}</div>}
      {actions && (
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
