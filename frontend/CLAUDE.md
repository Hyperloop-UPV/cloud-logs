# CLAUDE.md — frontend

Guía para trabajar en el frontend de `cloud-logs`. Lo general del backend está en el
`CLAUDE.md` de la raíz.

## Qué es

SPA de React 19 + Vite + TS que consume el API de `cloud-logs`. Se construye sobre
`@hyperloopupv/frontend-kit` y sigue el lenguaje de diseño de los frontends del equipo
(`../../soft-front/frontend`).

Seis pantallas, todas vivas (`src/constants/pages.ts`, salvo About que vive en el
pie del raíl):

| Ruta | Qué es |
| --- | --- |
| `/` | Dashboard: métricas, volumen mensual con uPlot, reparto por estado, tags y actividad reciente. Todo enlaza al catálogo con el filtro puesto |
| `/catalog` | Tabla con filtros, orden y paginación. Pinchar una fila abre la ficha (`?log=<uuid>`), editable. Selección múltiple con etiquetado en lote, búsquedas guardadas, columnas y densidad configurables, export a CSV |
| `/tags` | Las etiquetas en tres modos (`?view=cards\|table\|graph`): tarjetas, tabla ordenable y tarjetas o tabla (el grafo tiene pantalla propia) |
| `/upload` | Subida en dos fases directa a Drive, con cola, progreso y cancelación |
| `/team` | Usuarios y roles, más el `cleanup` con previsualización. Solo admin |
| `/about` | Quién la ha hecho, la pila y el estado del servicio |

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
- **El API no agrega por etiqueta.** `/logs/tags` devuelve solo nombres y
  `stats.topTags` son los diez primeros con el número de logs y nada más. Todo lo
  que enseña `/tags` —bytes, fechas, reparto por estado, co-ocurrencia— lo calcula
  `features/tags/useTagAggregate.ts` paginando `/logs` (tope `pageSize=100`). Está
  **acotado a 20 páginas** y, si corta, la pantalla lo dice: enseñar cifras
  parciales como si fueran el total es mentir sobre el archivo. Si algún día se
  añade un `GET /logs/tags/stats`, este hook es lo que hay que sustituir.
- **El grafo de etiquetas usa `react-force-graph-2d`** (d3-force sobre canvas),
  no una simulación propia: lo que hace buena a esta vista es la interacción
  —arrastrar, hacer zoom, desplazarse— y eso es justo lo que se rompe al
  reimplementarlo. Hubo un `tagGraphLayout.ts` hecho a mano; se retiró. Tres cosas
  que hay que respetar en `features/tags/TagGraph.tsx`:
  - **`graphData` tiene que ser referencialmente estable.** La librería guarda la
    posición y la velocidad *dentro* de los objetos de nodo; si recibe un objeto
    nuevo en cada render, reinicia la simulación y el grafo tiembla. Va en un
    `useMemo` que depende solo de los datos.
  - **El canvas no hereda CSS** (la misma trampa que uPlot). Los colores salen de
    `readThemeColors()`, y se releen con un **`MutationObserver` sobre la clase de
    `documentElement`**, no con un prop `isDark`: la clase `.dark` la pone un efecto
    de un componente antecesor y **los efectos de los hijos corren antes que los de
    los padres**, así que mirando el prop se leerían los colores del tema anterior.
  - **El texto se pinta dividiendo por la escala** en `nodeCanvasObject`; si no,
    las etiquetas crecen como globos al acercar el zoom.
  - **El grafo es su propia pantalla** (`/graph`, `features/graph/`), no un modo de
    `/tags`. Comparte `useTagAggregate` con ella a proposito: misma clave de
    react-query, así que saltar entre las dos **no vuelve a barrer el catálogo**.
    Por eso el hook se queda en `features/tags/` y `GraphPage` lo importa de ahí.
  - `/tags?view=graph` **redirige a `/graph`**: el grafo fue un modo de esa
    pantalla antes de tener la suya, y los enlaces y marcadores viejos no deben
    caer en las tarjetas sin explicación.
  - El lienzo se llama `GraphCanvas`, no `TagGraph`: dibuja un nodo por log
    también, y el nombre viejo describía mal lo que hace.
  - **La ruta va con `lazy()`.** `react-force-graph` es la dependencia más gorda
    del proyecto (~210 kB de trozo propio); metida en el bundle de `/tags` hacía
    que esa pantalla se descargara entera para nada.
  - **El grafo es bipartito**: un nodo por log y uno por etiqueta, unidos cuando el
    log la lleva. Nada de aristas log-log: con N logs serían N² líneas.
  - **El área del nodo es proporcional al tamaño**, no el radio. Se probó una
    escala logarítmica suponiendo que el rango de tamaños la pediría, y medida
    contra los datos reales salió peor: apelotonaba el 60% de los logs en el tramo
    más grande frente al 32% del área. Si los tamaños llegan a abarcar varios
    órdenes de magnitud, vuelve a medirlo antes de cambiarlo.
  - **`TAG_MIN_R` tiene que ser mayor que `LOG_MAX_R`.** Si la etiqueta más pequeña
    puede ser menor que el log más grande, la jerarquía se invierte y un fichero
    gordo parece un punto de anclaje. Es un invariante, no una preferencia.
  - Los logs toman el color de su estado (`statusStyles.canvasColor`, el gemelo en
    crudo de `markClass` porque en canvas una clase de Tailwind no sirve) y las
    etiquetas van en el naranja de marca.
  - **Los extremos de una arista se leen SIEMPRE con `endId()`.** d3-force
    sustituye en el sitio las cadenas `source`/`target` por los objetos de nodo en
    el primer tick, así que `link.source === id` da falso en cuanto la simulación
    arranca. Ya costó un fallo: el cálculo del vecindario comparaba en crudo, el
    conjunto se quedaba con un solo elemento y los vecinos, en vez de resaltarse,
    caían en la rama de atenuado — **se apagaban**. El síntoma delata el patrón:
    las aristas se iluminaban (usan `endId()`) y los nodos no.
  - **Al señalar un nodo, sus vecinos a una arista se tiñen del acento, más
    claro** (`lighten()`, mezclando hacia blanco y no hacia el fondo: hacia el
    fondo saldría más claro en el tema claro pero más *oscuro* en el oscuro).
    Solo los logs: una etiqueta ya va de ese color y aclararla la haría parecer
    apagada justo al señalarla. El relleno naranja tapa el color de estado, que
    es información, así que **el estado pasa al borde** en vez de perderse.
  - `lighten()` **devuelve el color intacto si no lo puede leer.** Las variables
    del kit son hex, pero un tema podría declarar `oklch()`. Asignar una cadena
    inválida a `fillStyle` no da error: el canvas se queda con el color anterior
    sin avisar, y ese fallo sería invisible.
  - El acento sale de `--primary`, **que no siempre es naranja** — el kit trae un
    tema rosa (`#db2777`). Nada de escribir el naranja a mano aquí.
  - **La fluidez es física, no animación.** Estaba congelándose a los 160 ticks y
    por eso se sentía rígida. Lo que la suelta: `warmupTicks` (arranca ordenado,
    sin explosión inicial), `d3AlphaDecay` bajo (se enfría despacio, los nodos se
    deslizan en vez de llegar de un tirón), `d3VelocityDecay` bajo (conservan
    inercia) y `cooldownTime` generoso. Si tocas `cooldownTicks`, vuelves a
    congelarlo.
  - **Pantalla completa** con la Fullscreen API sobre el contenedor. El estado se
    sincroniza con el evento `fullscreenchange`, no al pulsar el botón: el usuario
    puede salir con Escape y si no, el botón acabaría mintiendo. `requestFullscreen`
    puede rechazarse, así que la promesa lleva su `catch`.
  - El lienzo lleva **relleno en los cuatro lados** (`p-4`). Estuvo en
    `px-4 pb-4` y quedaba pegado a la cabecera con 16 px en los otros tres: el
    canal que falta arriba se nota justo porque los demás están.
  - **El grafo ocupa todo el alto de la sección**, y para eso la cadena de flex
    tiene que llegar entera: `SidebarInset` (`flex h-full flex-col`) → cabecera
    `shrink-0` → el contenedor de la vista, que con `?view=graph` pasa a
    `flex min-h-0 flex-1 flex-col overflow-hidden` en lugar de `overflow-auto` →
    la raíz del grafo → la caja del lienzo. Si un eslabón pierde `min-h-0` o se
    queda en alto automático, el lienzo colapsa o desborda. Las otras dos vistas
    siguen con scroll, que es lo que una lista larga necesita.
  - Las aristas van **más gordas de lo que pide la legibilidad estricta** (1,2 px,
    2,6 px al resaltar): con los nodos pequeños, las líneas son lo que da cuerpo
    al dibujo.
  - El chunk de `/tags` pesa ~215 kB por la librería. No importa porque la ruta va
    con `lazy()`, pero no la importes desde el bundle principal.
- **La pantalla de acceso lleva trazas de fondo que NO son datos.** La geometría
  vive en `routes/signInTrace.ts`, puro y sin DOM para poder verificarlo en Node.
  Se lee como ambiente porque **no tiene ejes, ni valores, ni rejilla, ni leyenda**,
  y sangra por los bordes con un claro en el centro. Si se le añade cualquiera de
  esas cosas empezará a parecer una lectura real del pod y dejará de ser honesta.
  Los pesos de los cuatro senos de `waveform()` **suman exactamente 1**, que es lo
  que acota la salida en `[-1, 1]`; si se tocan hay que mantener esa suma.
- **Solo un canal de la traza es de marca.** El color saturado significa estado y
  el naranja se reserva para marca y acción primaria; varias trazas naranjas se
  leerían como medidas.
- **`/api/v1/health` es público** (`app/main.py:139`, sin dependencia de auth) y
  `getHealth()` ya va con `skipAuthRetry`. Por eso el acceso puede decir si el API
  responde antes de que nadie pulse nada, sin tocar el backend.
- **Borrar es blando en el backend y el diálogo lo dice.** `DELETE /logs/{id}`
  solo pone `deleted_at`: la fila se queda en SQLite y **no se toca nada en Google
  Drive** (`delete_log` no llama a Drive). Las dos frases del diálogo de
  confirmación se apoyan en eso y están verificadas contra la base de datos; si
  algún día el backend borra de verdad, hay que reescribirlas.
- **No hay papelera porque el API no la permite.** Ningún endpoint lee un log
  borrado —todas las consultas filtran `deleted_at IS NULL`— y no existe
  restaurar. Lo único que toca esas filas es `POST /logs/cleanup?purgeSoftDeleted=true`,
  que las destruye. Una papelera necesitaría `POST /logs/{id}/restore` y un
  `includeDeleted`; es trabajo de backend, no de aquí.
- **Editar y borrar comparten permiso.** El backend aplica la misma
  `check_log_modification_permission` a `PATCH` y a `DELETE`, así que
  `LogDetailSheet` tiene un solo `canModify` y no dos banderas que podrían
  separarse por error.
- Un **404 al borrar se trata como éxito**: significa que ya no está, que es el
  estado que se quería. Dar error ahí dejaría al usuario atascado ante algo que ya
  se cumplió.
- Tras borrar hay que invalidar también **`["tagAggregate"]`**, o el log seguirá
  dibujándose como nodo en `/graph`.
- **El botón de cerrar del `Sheet` del kit es `absolute top-4 right-4`**, fuera
  del flujo, y `SheetHeader` lleva `p-4`: el icono ocupa de 16 a 32 px desde el
  borde, justo encima de los primeros 16 px del contenido de la cabecera. Un
  elemento alineado a la derecha ahí (el badge de estado de `LogDetailSheet`) se
  le monta debajo. Se arregla reservándole sitio con `pr-6` en esa fila, no
  moviendo el botón.
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
