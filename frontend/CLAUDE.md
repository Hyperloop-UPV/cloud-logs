# CLAUDE.md — frontend

Guía para trabajar en el frontend de `cloud-logs`. Lo general del backend está en el
`CLAUDE.md` de la raíz.

## Qué es

SPA de React 19 + Vite + TS que consume el API de `cloud-logs`. Se construye sobre
`@hyperloopupv/frontend-kit` y sigue el lenguaje de diseño de los frontends del equipo
(`../../soft-front/frontend`).

Cuatro pantallas, todas vivas (`src/constants/pages.ts`):

| Ruta | Qué es |
| --- | --- |
| `/` | Dashboard: métricas, volumen mensual con uPlot, reparto por estado, tags y actividad reciente. Todo enlaza al catálogo con el filtro puesto |
| `/catalog` | Tabla con filtros, orden y paginación. Pinchar una fila abre la ficha (`?log=<uuid>`), editable. Selección múltiple con etiquetado en lote, búsquedas guardadas, columnas y densidad configurables, export a CSV |
| `/upload` | Subida en dos fases directa a Drive, con cola, progreso y cancelación |
| `/team` | Usuarios y roles, más el `cleanup` con previsualización. Solo admin |

## Comandos

```bash
npm run dev      # Vite en :5173, con proxy /api -> localhost:8000
npm run build    # tsc -b && vite build. Debe pasar limpio
npm run lint     # oxlint
npx prettier --write src   # ordena también las clases de Tailwind
```

Para apuntar a otro backend: `VITE_API_TARGET=http://127.0.0.1:8001 npm run dev`.

## Trampas que ya han costado tiempo

- **`.gitignore` se come carpetas de código llamadas `logs`.** La plantilla de Vite
  trae un patrón `logs` sin anclar, que casa con cualquier carpeta de ese nombre a
  cualquier profundidad. Una feature en `src/features/logs/` quedaba invisible para git
  **y** para Tailwind (que respeta `.gitignore`), así que sus clases no se generaban y
  la pantalla salía a medio estilar. El patrón ya está acotado a `/logs/`, pero no
  vuelvas a poner código en una carpeta con un nombre que el `.gitignore` ignore: la
  feature del catálogo se llama `src/features/catalog/` por esto.
- **`@source` es obligatorio en `src/index.css`.** Las rutas `@source` del kit se
  resuelven a través del symlink de `node_modules` y no alcanzan este árbol. Sin esa
  línea Tailwind no genera ninguna clase propia.
- **`max-w-sm` y compañía están roto**s: los tokens `--spacing-*` del kit secuestran la
  escala de tamaños con nombre y resuelven a unos píxeles. Usa valores arbitrarios,
  `max-w-[22rem]`.
- **No uses los primitivos `Table` del kit** para tablas con cabecera fija: se
  autoenvuelven en un `div` con `overflow-x-auto` no configurable y el `sticky` no pega.
  Se monta la `<table>` a mano, como el resto de la familia.
- **Importa siempre por subpath** (`/components`, `/icons`, `/lib`, `/outreach/...`).
  La raíz del paquete solo reexporta componentes, y el barrel `/hooks` arrastra rxjs.
- **No añadas `@radix-ui/*`** como dependencia: dos copias rompen el focus-trap y el
  scroll-lock. `lucide-react` debe quedarse en `>=0.500 <1`, que es el rango del peer
  del kit.
- El kit solo reexporta **28** iconos de Lucide curados (`AlertCircle`, `Columns`,
  `Filter`, `ExternalLink`, `Database`, `Upload`, `RefreshCw`, `Trash2`…); los que
  falten se importan de `lucide-react` directamente.
- **uPlot no hereda nada del CSS.** Pinta en canvas, así que los colores van dentro
  de las `Options` y el tamaño en píxeles. Eso obliga a dos cosas en
  `MonthlyVolumeChart.tsx`: un `ResizeObserver` para que se adapte al ancho, y
  reconstruir la gráfica entera cuando cambia el tema (por eso `isDark` está entre
  las dependencias del efecto). Los colores se leen de las variables del kit en
  `constants/chartConfig.ts`, no escritos a mano.
- **Un CSV se puede ejecutar.** Excel y Sheets interpretan como fórmula cualquier
  celda que empiece por `=`, `+`, `-` o `@`, así que un nombre de fichero que empiece
  por guion se ejecutaría al abrir el export. `exportCsv.ts` le antepone un apóstrofo
  a esas celdas. También lleva BOM y CRLF, que es lo que hace que Excel abra el
  fichero con los acentos bien.
- **`PlainHeader` acepta hijos** además de `label`, que es como la cabecera lleva la
  casilla de «seleccionar todo» sin duplicar el componente.
- **El `SegmentedControl` del kit reparte el ancho a partes iguales**
  (`width: 100/n %`), porque su indicador deslizante se mueve con
  `translateX(100% * i)` y eso solo cuadra si todos los segmentos miden lo mismo.
  Con etiquetas de longitud desigual —«Ready 54» frente a «All»— las largas parten
  en dos líneas y el control queda dentado. Además su `label` es un `string`, así
  que un recuento atenuado dentro del segmento no cabe en su modelo. Para eso está
  `features/catalog/StatusFilter.tsx`, que conserva el lenguaje visual (caja
  `bg-muted`, activo en `bg-background` con sombra) y solo cambia el reparto: cada
  segmento mide lo que mide su texto. Úsalo como referencia antes de meter texto
  variable en el control del kit.
- **El `Combobox` del kit no sirve para los tags.** Su modelo es de selección pura y
  aquí hace falta además *crear* un tag que todavía no existe. Para las dos cosas
  está `features/catalog/TagEditor.tsx`, con `allowCreate` para distinguirlas.

## Convenciones

- **Vocabulario del equipo.** La unidad que construye esto es **Hyperloop UPV
  Software H12** (H12 es la generación del pod); el pie de la pantalla de acceso
  firma así. No es un «department» ni un «area»: no lo llames de otra forma. Y
  **software no es un subsistema**: `subsystem`, la clave que aparece dentro de
  `clientMetadata`, designa partes *del pod* (propulsion, levitation, BMS, LCU,
  PCU…), no unidades del equipo. El icono de `SoftwareMark` no es específico de una
  generación, así que su `alt` se queda en «Hyperloop UPV Software», sin el H12.
- **Textos de interfaz en inglés**, sentence case. Las mayúsculas se aplican con
  `uppercase` de Tailwind, nunca escritas en el string. Caracteres tipográficos reales
  (`…`, `—`, `→`, `✕`). Los comentarios del código están en español.
- Densidad alta: cuerpo de tabla `text-xs`, cabeceras `text-[10px]`, celdas `py-2 pr-3`.
  Números con `text-right font-mono tabular-nums`. Celda vacía con `—`.
- **El color saturado solo significa estado.** El naranja de marca queda para la marca
  y la acción principal. Los cuatro estados salen de un mapa único,
  `src/features/catalog/statusStyles.ts`, del que se derivan la barra del borde de la
  fila, el punto y el badge.
- Lo inactivo se marca con opacidad, no con otro color.
- Todo fichero no trivial abre con un comentario que explica qué es y por qué.

## Arquitectura

- `src/api/` — `client.ts` tiene el `request()` con el token en memoria y el refresh
  **single-flight**: el backend rota el refresh token en cada uso y trata el reuso de uno
  revocado como robo, revocando la familia entera. Si dos peticiones caducan a la vez y
  cada una pide refresh, la segunda parece un reuso y echa al usuario. No rompas esa
  propiedad.
- `src/auth/` — `AuthProvider` intenta un refresh al arrancar: la sesión sobrevive a una
  recarga sin pasar por GitHub.
- `src/features/catalog/useLogSearch.ts` — filtros, orden y página viven en la query
  string. La URL es la fuente de verdad, para que una búsqueda se comparta por enlace.
- `src/components/data/ui.tsx` — primitivas de tabla densa adaptadas de
  `adj-view/src/adj/v2/ui.tsx`. Si necesitas otra, mira primero si existe allí.
  La constante `STICKY_HEADER` concentra las clases de una cabecera pegajosa: el
  padding vertical y **el borde inferior van en el `<th>`**, porque un `border-b`
  declarado en el `<tr>` no acompaña a unas celdas `sticky` y la cabecera se queda
  flotando sin línea sobre los datos.
- **Las rutas pesadas van con `lazy()`** en `App.tsx`. El catálogo entra en el bundle
  principal porque es la pantalla de trabajo diario; el dashboard (que arrastra
  uPlot), la subida y el equipo se cargan al visitarlos.
- **Qué va en la URL y qué en `localStorage`.** En la query string va lo que
  describe *qué datos* se miran (filtros, orden, página, log abierto), porque eso es
  lo que tiene sentido compartir por enlace. En `localStorage` va lo que describe
  *cómo* los quiere ver una persona en su pantalla: columnas y densidad
  (`useTablePrefs.ts`) y las búsquedas guardadas (`useSavedViews.ts`). Mandarle a un
  compañero tu configuración de columnas pegada a la búsqueda sería imponérsela.
  Las dos lecturas y las dos escrituras van en `try/catch`: en una pestaña privada
  `localStorage` lanza.
- `src/features/catalog/useBulkTags.ts` — el API edita de uno en uno, así que un
  lote son N `PATCH`. Dos cosas que no se pueden perder: van con **concurrencia
  limitada** (el backend corre con un solo worker de uvicorn sobre SQLite), y los
  **403 se cuentan y se dicen** («3 updated · 5 skipped (not yours)»). Un usuario
  normal solo puede editar sus propios logs, así que en una selección mixta habrá
  403 siempre; el lote no se aborta por ellos ni finge que fue bien. La selección se
  limpia al cambiar de página o de filtros, para no editar a ciegas lo que no se ve.
- `src/features/upload/useUploadQueue.ts` — el progreso del XHR llega en ráfagas de
  decenas por segundo, así que se acumula en una ref y se vuelca al estado a
  intervalo fijo. Un `setState` por evento haría re-renderizar la página entera
  decenas de veces por segundo.

## Divergencias conscientes de los demás frontends del equipo

| Divergencia | Motivo |
| --- | --- |
| Paginación explícita | Decisión de producto; el API pagina por offset y así la posición cabe en la URL. El resto de las vistas usan scroll continuo con contador `n / total` |
| `@tanstack/react-query` | La capa `src/api/` ya existía; esta app es REST paginada, no telemetría por WebSocket. Las demás vistas usan `fetch` + Zustand |
| `BrowserRouter` | No se sirve desde Electron, así que no hace falta `HashRouter` |
| `npm` | El repo `cloud-logs` ya tiene `package-lock.json`; el monorepo del equipo usa pnpm |
| Tema inicial según el sistema | `logging-view` y `competition-view` arrancan en oscuro; aquí se sigue a `prefers-color-scheme`, como `adj-view` |

## Las dos formas de entrar

1. **GitHub OAuth**, la normal.
2. **Master key**, plegada tras «Use a master key instead» en la pantalla de acceso.
   Sirve para operación y para desarrollo sin tener la OAuth App configurada.

Lo que hay que saber de la segunda, porque no es simétrica con la primera:

- El backend acepta la clave en `Authorization: Bearer`, **igual que un JWT**, así
  que ocupa la misma ranura del cliente y `request()` no necesita un camino aparte.
- **No hay refresh.** La clave no caduca, y ante un 401 no hay nada que renovar:
  pedir un refresh cerraría la sesión por un fallo que no es de expiración. Por eso
  `masterMode` en `api/client.ts` apaga las dos rutas de refresh (la proactiva y la
  del reintento).
- **`/users/me` responde 401** con master key («User profile not available for
  system callers»): no hay fila de usuario detrás. La identidad se sintetiza en
  `AuthContext.tsx` (`MASTER_USER`), copiando el UUID de ceros y el nombre
  `master_api_key` que usa `app/dependencies.py::get_current_user`, para que la
  interfaz y los logs del servidor digan lo mismo. **No llames a `getMe()` en modo
  master.**
- La validación previa es `GET /users?pageSize=1`: es de solo-admin, así que un 200
  confirma de una vez que la clave vale y que da nivel de administración.
- Se guarda en **`sessionStorage`, no en `localStorage`**: es una credencial de
  administración completa, así que muere al cerrar la pestaña. El pie del raíl la
  nombra «Master key · Full access · this tab only» y no `master_api_key`, para que
  nadie la confunda con una cuenta.
- `signOut` no llama a `/logout` en modo master: no hay refresh token que revocar y
  el endpoint responde 401.

## Login en desarrollo

El SPA recibe el callback de GitHub, así que en el `.env` del backend y en la OAuth App
hace falta:

```
GITHUB_REDIRECT_URI=http://localhost:5173/auth/callback
```

Si apunta al backend, el navegador aterriza en un JSON en vez de volver a la app.
