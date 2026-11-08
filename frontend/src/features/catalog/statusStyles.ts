// Estilo unico de los cuatro estados del catalogo.
//
// De aqui salen las tres representaciones del estado, para que no se desincronicen:
// la barra del borde izquierdo de la fila (lo que se escanea en vertical), el punto
// y el badge. La formula de color es la de la familia:
// border-X-500/30 bg-X-500/10 text-X-600 dark:text-X-400, con el punto en bg-X-500.

import {
  AlertTriangle,
  Check,
  Circle,
  AlertCircle,
  XCircle,
} from "@hyperloopupv/frontend-kit/icons";
import type { LucideIcon } from "@hyperloopupv/frontend-kit/icons";
import type { LogStatus } from "../../api/types";

interface StatusStyle {
  /** Texto corto para la columna de estado. */
  label: string;
  /** Frase para el tooltip: que significa el estado. */
  description: string;
  icon: LucideIcon;
  /** Badge completo. */
  badgeClass: string;
  /** Barra solida del borde izquierdo de la fila y punto. */
  markClass: string;
}

export const statusStyles: Record<LogStatus, StatusStyle> = {
  ready: {
    label: "Ready",
    description: "Verified in Google Drive and available to download",
    icon: Check,
    badgeClass:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    markClass: "bg-emerald-500",
  },
  pending_upload: {
    label: "Pending",
    description: "Registered, but the archive has not finished uploading",
    icon: Circle,
    badgeClass:
      "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    markClass: "bg-amber-500",
  },
  failed: {
    label: "Failed",
    description: "The upload could not be verified in Google Drive",
    icon: XCircle,
    badgeClass:
      "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
    markClass: "bg-red-500",
  },
  aborted: {
    label: "Aborted",
    description: "Cancelled before the transfer completed",
    icon: AlertTriangle,
    badgeClass:
      "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
    markClass: "bg-zinc-500",
  },
};

/** Orden en que se ofrecen los filtros de estado: de lo util a lo residual. */
export const STATUS_ORDER: LogStatus[] = [
  "ready",
  "pending_upload",
  "failed",
  "aborted",
];

/** El API podria devolver un estado que esta UI no conozca todavia. */
const FALLBACK: StatusStyle = {
  label: "Unknown",
  description: "Status not recognised by this version of the app",
  icon: AlertCircle,
  // Borde discontinuo: lo desconocido no puede parecerse a un estado real, y
  // 'aborted' ya ocupa el gris solido.
  badgeClass:
    "border-dashed border-slate-500/40 bg-slate-500/10 text-slate-600 dark:text-slate-400",
  markClass: "bg-slate-400",
};

export function statusStyle(status: string): StatusStyle {
  return statusStyles[status as LogStatus] ?? FALLBACK;
}
