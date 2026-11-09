// Mapa de rutas de la aplicacion, al estilo de competition-view/src/constants/pages.ts.
//
// Van agrupadas como se leen: primero lo que se consulta (resumen y catalogo) y
// despues lo que se escribe (subir y administrar). El rail pinta un grupo por cada
// `section`, en este orden.

import { Database, Upload } from "@hyperloopupv/frontend-kit/icons";
import type { LucideIcon } from "@hyperloopupv/frontend-kit/icons";
// El kit solo reexporta 28 iconos de Lucide curados; su README indica traer de
// lucide-react los que falten.
import { LayoutDashboard, Share2, Tags, Users } from "lucide-react";

export type Section = "Overview" | "Archive";

interface Page {
  title: string;
  icon: LucideIcon;
  section: Section;
  /** Solo visible para administradores. */
  adminOnly?: boolean;
}

export const PAGES: Record<string, Page> = {
  "/": { title: "Dashboard", icon: LayoutDashboard, section: "Overview" },
  "/catalog": { title: "Catalog", icon: Database, section: "Overview" },
  "/tags": { title: "Tags", icon: Tags, section: "Overview" },
  "/graph": { title: "Graph", icon: Share2, section: "Overview" },
  "/upload": { title: "Upload", icon: Upload, section: "Archive" },
  "/team": { title: "Team", icon: Users, section: "Archive", adminOnly: true },
};

export const PAGES_ARRAY = Object.entries(PAGES).map(([url, page]) => ({
  url,
  ...page,
}));

export const SECTIONS: Section[] = ["Overview", "Archive"];
