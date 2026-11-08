// Esqueleto de carga.
//
// Es una <table> con exactamente las mismas columnas y anchos que LogTable, no una
// pila de divs: si no coinciden, al llegar los datos la maquetacion da un salto, que
// es justo lo que un esqueleto existe para evitar.
//
// Los anchos de las barras varian un poco por fila para que no parezca una rejilla
// impresa, pero de forma determinista (segun el indice), no aleatoria: un ancho que
// cambia en cada render parpadea.

import { Skeleton } from "@hyperloopupv/frontend-kit/components";

/** Anchos de la columna de nombre, en rotacion, para romper la uniformidad. */
const NAME_WIDTHS = ["w-[70%]", "w-[85%]", "w-[55%]", "w-[78%]", "w-[62%]"];

export function LogTableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="px-4">
      <table className="w-full min-w-[52rem] text-xs">
        <tbody>
          {Array.from({ length: Math.min(rows, 14) }, (_, i) => (
            <tr key={i} className="border-b">
              <td className="p-0">
                <Skeleton className="h-8 w-[3px] rounded-none" />
              </td>
              <td className="py-2 pr-3 pl-3">
                <Skeleton
                  className={`h-3 ${NAME_WIDTHS[i % NAME_WIDTHS.length]}`}
                />
              </td>
              <td className="py-2 pr-3">
                <Skeleton className="h-3.5 w-14 rounded" />
              </td>
              <td className="py-2 pr-3">
                <Skeleton className="h-3 w-40" />
              </td>
              <td className="py-2 pr-3">
                <Skeleton className="ml-auto h-3 w-10" />
              </td>
              <td className="py-2 pr-3">
                <Skeleton className="ml-auto h-3 w-14" />
              </td>
              <td className="py-2 pr-3">
                <Skeleton className="h-3 w-20 rounded-full" />
              </td>
              <td className="py-2 pr-3">
                <Skeleton className="h-3 w-16" />
              </td>
              <td className="py-2 pr-3">
                <Skeleton className="h-3 w-20" />
              </td>
              <td className="py-2">
                <Skeleton className="ml-auto size-3.5" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
