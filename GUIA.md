# Generador visual de documentos desde plantillas

Aplicación web que rellena una plantilla de **Google Docs** con datos de una
**hoja de Google** (o, en el futuro, de una API externa) y genera un **PDF por
cada fila o grupo**. Pensada para personas sin conocimientos técnicos: una sola
pantalla estilo Scratch — paleta de datos y bloques, arrastrar y soltar sobre el
documento, condiciones sin código.

Sustituye un flujo antiguo de Google Apps Script por una herramienta visual y manual.

## Cómo ejecutar

```bash
npm install
npx playwright install chromium   # una sola vez (motor de PDF local + miniaturas)
docker compose up -d               # base de datos (biblioteca de plantillas)
npm run dev                        # http://localhost:3000
```

Requisitos: Node 20+, Docker (para la biblioteca de plantillas). Chromium lo usa
el servidor para los PDF locales y las miniaturas. Sin Docker, el editor y la
generación funcionan igualmente; solo guardar/listar plantillas necesita la DB.

### Base de datos (biblioteca de plantillas)

Postgres 16 en Docker (`docker-compose.yml`, puerto **5433** para no chocar con
un Postgres local; volumen `ttg-pgdata`). Conexión por `DATABASE_URL` en `.env`.
Elegido sobre SQLite porque la app se desplegará para varios departamentos
(servidor compartido, concurrencia); el acceso está aislado en `server/db.ts`
(cliente `postgres` + migraciones numeradas mínimas aplicadas lazy al primer
uso — tabla `schema_migrations`). La tabla `recipes` guarda la plantilla
completa (HTML editado ~1 MB, CSS, orígenes, vínculos, agrupación) + miniatura
PNG (`bytea`, generada con Playwright al guardar), y pertenece a un usuario
(`owner_id` → `users`, cada uno ve solo lo suyo). `users` guarda también la
conexión Google de cada persona (refresh token); `sessions` las sesiones de la
app (cookie `ttg_session` httpOnly, 30 días deslizantes, solo el hash SHA-256
del token en la DB).

La biblioteca de plantillas vive exclusivamente en Postgres. El antiguo store
`ttg-recipes` y su migración desde localStorage se retiraron una vez terminada
la ventana de compatibilidad; una clave antigua que quede en un navegador se
ignora y no se borra automáticamente.

### Entrada con Google = login de la app (paginación exacta + documentos privados)

La app es multiusuario: **entrar con Google ES el login**. El mismo
consentimiento concede la identidad (sesión de la app) y los permisos de Drive:
(a) los PDF los genera **Google Docs** con la cuenta del usuario (mismo motor
de maquetación que el documento original → saltos de página idénticos) y
(b) la app puede **leer Docs y Sheets privados** a los que esa cuenta tenga
acceso — ya no hace falta "cualquier persona con el enlace".
Configuración una sola vez:

1. <https://console.cloud.google.com> → crea (o elige) un proyecto.
2. "APIs y servicios" → "Biblioteca" → activa **Google Drive API** y
   **Google Sheets API** (Drive genera los PDF y lee Docs; Sheets lee hojas
   privadas respetando la pestaña `gid` del enlace).
3. "Pantalla de consentimiento OAuth" → tipo **Interno**: solo miembros de tu
   organización de Google Workspace pueden entrar. Además el servidor rechaza
   cualquier email fuera de `ALLOWED_GOOGLE_HD` (`.env`).
4. "Credenciales" → "Crear credenciales" → "ID de cliente de OAuth" → tipo
   "Aplicación web" → URI de redireccionamiento autorizado:
   `http://localhost:3000/oauth/callback`.
5. Copia ID y secreto a `.env` (plantilla en `.env.example`) y reinicia el
   servidor.

Sin sesión, cualquier ruta redirige a **/login** ("Entrar con Google"). El
refresh token de cada usuario vive en su fila de `users` (la DB; sobrevive
reinicios); **Cerrar sesión** solo borra la sesión de la app, no la conexión
Drive. Ámbitos pedidos: `drive` completo (leer plantillas/datos privados,
crear/exportar/borrar los Docs temporales y subir a carpetas elegidas por URL)
+ `openid email` (identidad). Una conexión antigua con menos permisos muestra
en el chip **"Reconectar (permiso de lectura / permisos de Drive)"**; una
revocada, **"Reconectar Google"** — reconectar es simplemente repetir el
consentimiento (el refresh token nuevo sobrescribe el guardado).

Lectura con fallback: se intenta primero por API con la cuenta del usuario
(privados OK); si esa cuenta no tiene acceso se prueba el export público.

Todas las server functions exigen sesión (`requireUser`); sin ella devuelven
`code: 'AUTH'` y el cliente redirige a /login. `recipes` y `generation_runs`
se filtran siempre por `owner_id` (un id ajeno responde "ya no existe" — sin
fuga de existencia).

**OJO — los dos exports HTML de Google son distintos:** el público
(`export?format=html`) trae un `<style>` con clases y la geometría de página en
la clase del `<body>`; el de la Drive API (`files.export` a `text/html`) NO trae
`<style>`: todo son estilos inline y la geometría va como `style="…"` del
`<body>`. `extractCss` (template/parse.ts) preserva ese style inline del root
como regla `body{…}` — sin eso el documento se ve gris, sin fondo ni márgenes
(editor, vista previa y PDF local). El export de la API tampoco trae `<title>`;
el nombre real se pide aparte (`files/{id}?fields=name`).

### Exportar a Word (.docx)

En el diálogo de generación, con cuenta de Google conectada, la casilla
"Incluir también Word (.docx) editable" exporta cada documento además como
`.docx` (mismo Doc temporal, segundo export con el MIME de Word). Sin cuenta
conectada no está disponible (el motor local solo produce PDF).

## Flujo (una sola pantalla)

```
+--------------------------------------------------------------------------+
| [Enlace del Doc][🔍]  [Hoja|API][enlace][🔍]  [Agrupar v] [Vista previa] [Generar PDF] |
+-----------+--------------------------------------------------------------+
| PALETA    |  DOCUMENTO (iframe editable / vista previa)                  |
| Datos:    |                                                              |
|  nombre   |  Estimado {{nombre}} …                                       |
|  DNI …    |  ┌ texto condicional — clic para editar ┐                    |
| Bloques:  |  │ Si provincia es «Madrid» → Aviso …   │                    |
|  Condición|  └───────────────────────────────────────┘                   |
|  Repetir  |                                                              |
+-----------+--------------------------------------------------------------+
```

- **Barra superior**: carga el Doc (enlace público) y los datos (Hoja de Google /
  API externa), elige la agrupación (un documento por fila o por grupo), alterna
  edición ⇄ vista previa y genera los PDF (individual + `.zip`).
- **Hojas con varias pestañas**: la pestaña se decide por el `#gid=` del enlace
  (un enlace del botón Compartir no lo lleva → primera pestaña). Al cargar, se
  lista las pestañas (`listSheetTabsFn`: Sheets API con cuenta conectada; sin
  cuenta, parseadas del JS embebido del `htmlview` público —
  `items.push({name:…, gid:…})`, el menú NO está en el HTML estático) y, si hay
  más de una, aparece un **selector de pestaña** junto al enlace y el toast dice
  cuál se leyó. Cambiar de pestaña reescribe el `#gid` del enlace
  (`withSheetGid`) y recarga — las recetas heredan la pestaña porque guardan el
  enlace. Vía autenticada: un gid explícito que ya no existe da error claro (no
  cae en silencio a la primera pestaña); `extractSheetGid` devuelve `null` si el
  enlace no lleva gid (= primera pestaña, sin error).
- **Paleta (izquierda)**: las columnas de la hoja son chips que se **arrastran al
  documento** (drag & drop nativo, funciona dentro del iframe) o se insertan con
  un clic en el cursor. Un campo cuyo nombre coincide con una columna queda
  **vinculado de serie** (no hay paso de "asignar campos"). También hay un campo
  libre ("Otro campo…") y los bloques: **Texto condicional** y **Repetir por
  fila**. (No hay bloque de salto de página: los saltos los pone Google al
  generar — o el sync automático en la vía local.)
- **Documento (centro)**: el Doc con su CSS original, editable. Los campos son
  chips; los que no casan con ninguna columna se ven en ámbar y un clic abre el
  popover de vinculación. Al pasar el ratón por un chip, el tooltip dice con qué
  columna (o regla) se rellena; el popover marca la columna vinculada, indica si
  el vínculo es por coincidencia de nombre y permite «Desvincular». *Sugerir vínculos automáticamente* llama a la IA
  (`suggestMappingFn`, requiere `OPENAI_API_KEY`) y cae a la heurística
  `suggestMapping()` si no hay clave o falla.
- **Condiciones inline (estilo Scratch)**: la condición ES un bloque del
  documento — `<div class="ttg-cond" data-cond="…" contenteditable="false">` con
  un resumen legible ("Si provincia es «Madrid» → Aviso…"). Se inserta con clic
  (tras el bloque del cursor) o arrastrándola desde la paleta al punto exacto;
  un clic sobre ella abre el popover con las ramas
  (`si [columna] [es/no es/contiene] [valor] → mostrar…`), texto por defecto,
  Guardar / Eliminar. El JSON de la regla viaja URI-encoded en `data-cond` y el
  motor la resuelve **in situ**; dentro de una sección repetible se evalúa
  **una vez por fila** automáticamente. Los textos de cada rama y el texto por
  defecto son `contenteditable`: guardan siempre su versión plana y solo añaden
  HTML saneado cuando hay negrita/cursiva/subrayado/alineación. Esto también se
  aplica a reglas vinculadas a un `{{campo}}`; si tienen formato explícito se
  usa el fallback HTML con aviso porque `replaceAllText` no conserva rangos de
  estilo.
- **Repetir por fila**: con el cursor en un bloque alterna su
  `data-ttg-repeat`; con una **selección que abarca varios bloques** los
  envuelve en una sección repetible única (`<div data-ttg-repeat>`); volver a
  pulsar dentro del envoltorio lo deshace. Solo tiene efecto en modo
  **«un documento por grupo»** (repite por cada fila del grupo; en «por fila»
  cada documento lleva una única fila y no habría nada que repetir): al marcarla
  en modo por-fila un diálogo propone cambiar de modo, y si quedan secciones
  marcadas en por-fila la barra de estado lo avisa. No pide columna: la columna
  que define el grupo es la de la agrupación (barra superior). Al crear o
  cargar el wrapper se captura del contenido vecino la familia, tamaño, altura
  de línea y color para que los párrafos nuevos no caigan a la fuente del
  navegador aunque la plantilla defina la tipografía solo en spans/clases.
- **Barra de formato** sobre el lienzo: negrita, cursiva, subrayado y
  alineación (izquierda/centro/derecha/justificado) sobre la última selección
  activa, tanto en el iframe como dentro del diálogo de una regla.
  Implementada con `document.execCommand` + `styleWithCSS` (emite estilos
  inline como el propio export de Google); el botón hace `preventDefault` en
  mousedown para conservar la selección, y el estado activo se refresca con
  `queryCommandState` en `selectionchange`.
  **Centrar** además neutraliza `text-indent` y márgenes laterales de los
  bloques seleccionados (los párrafos del export de Google llevan sangría de
  primera línea y márgenes por clase; sin esto el texto queda anclado a la
  primera letra en lugar de centrado en la página).
- **Deshacer / rehacer / historial**: pila única de snapshots
  `(editorHtml, editorCss)` en el store (`checkpoint/undo/redo`, máx. 50, SOLO
  memoria — nunca en localStorage, un BOC son ~1 MB por snapshot). Cubre TODO:
  escritura (checkpoint en `beforeinput`, con coalescing por ráfaga en
  `pushHistory`), campos, condicionales, repetibles, formato, márgenes, cargar
  documento/plantilla y vaciar. El undo nativo del contenteditable NO ve las
  mutaciones programáticas, así que Ctrl+Z/Ctrl+Y se interceptan (dentro del
  iframe y global fuera de inputs) y van a esta pila. Aplicar un snapshot
  bumpea `docToken` (reescribe el iframe; el cursor se pierde — asumido).
  Botones en la barra de formato + panel "Historial de cambios" (entradas
  etiquetadas con hora; clic = volver a justo antes de ese cambio).
- **Documento en blanco**: el overlay del lienzo vacío ofrece "empezar con un
  documento en blanco (A4)" — crea vía `loadRawDocument` una página real
  (595pt de ancho total, márgenes 2,54 cm, Arial 11pt, fondo blanco, centrada),
  no un contenteditable sin estilo; así la regla de márgenes, el historial y el
  PDF funcionan igual que con un doc importado.
- **Regla de márgenes** (estilo Google Docs) bajo la barra de formato: regla en
  cm alineada con la página, dos triángulos arrastrables (también por teclado,
  flechas = 0,25 cm) que fijan los márgenes laterales. Modelo: la **página es de
  ancho fijo** — mover un margen estrecha el contenido (`max-width` compensado),
  nunca ensancha la página (sin esto el auto-centrado desplaza la referencia y
  amplifica el arrastre ~×2). Durante el arrastre se aplica inline con
  `!important` (feedback en vivo); al soltar se persiste como bloque
  reemplazable `/*ttg-margins*/body{padding-left/right + max-width}` al final
  de `editorCss` (gana a la clase de geometría de Google), que es lo que leen
  vista previa, PDF local (`padding` → margen `@page`) y vía Google.

**Patrón central**: todo lo que es "marcado" del documento vive **dentro del HTML
editable** — atributos y elementos `data-*` (`{{campo}}`, `data-page-break`,
`data-ttg-repeat`, `.ttg-cond[data-cond]`) — así sobrevive a la edición y viaja
entero por el pipeline (editor → plantilla → PDF) sin estado paralelo. El store
solo guarda orígenes, datos y vínculos explícitos campo→columna.

## Arquitectura

```
src/
  types.ts                 Modelo de dominio (Template, DataSource, TagMapping,
                           ConditionalRule, GroupConfig, GeneratedDocument…)
  lib/
    url.ts                 Enlaces públicos de Google -> URLs de exportación
    html.ts                Escape / strip de HTML
    cond.ts                Condición inline: JSON <-> data-cond (URI-encoded) + resumen legible
    editorHtml.ts          Chips del editor <-> {{campo}}, elemento .ttg-cond, chrome CSS
    template/parse.ts      extractDocument (doc crudo editable) + buildTemplate
                           (HTML editado -> bloques + campos + condiciones) + parseTemplate
    datasource/            Abstracción DataSource (ver más abajo)
    engine/
      substitute.ts        Sustitución de {{campo}} (tolera runs partidos de Google)
      conditionals.ts      Evaluación de reglas condicionales
      grouping.ts          Agrupa filas en documentos
      resolve.ts           Ensambla el documento final; resuelve .ttg-cond in situ
                           (por fila dentro de repetibles); mismo HTML preview y PDF
    ai/suggestMapping.ts   Sugerencia de mapeo por similitud (fallback sin IA)
    ai/mappingPrompt.ts    Helpers puros de la sugerencia IA (muestras truncadas,
                           prompt, schema, validación de respuesta)
    plan.ts                Puente estado -> motor (preview y generación)
    download.ts            Descargas en el navegador
  server/
    db.ts                  SOLO servidor: cliente Postgres + migraciones lazy
    recipesDb.ts           Server fns de la biblioteca: listar (resumen ligero
                           sin editor_html), obtener, guardar (+miniatura con
                           Playwright), renombrar, duplicar, eliminar
    fetch.ts               Server fns: leer Doc y leer datos (resuelven CORS).
                           Con cuenta conectada leen por API (privados OK) con
                           fallback al export público
    pdf.ts                 Server fn: HTML -> PDF con Playwright + zip (vía local)
    aiMapping.ts           Server fn: sugerencia de mapeo con OpenAI (gpt-5-mini,
                           JSON schema estricto; sin OPENAI_API_KEY responde
                           available:false y el cliente usa la heurística)
    googleClient.ts        SOLO servidor (import dinámico): OAuth (auth URL,
                           exchange con puerta de dominio, refresh por usuario
                           con dedupe; tokens en la tabla users) + Drive (subir
                           HTML como Doc temporal, exportar PDF/HTML, borrar) +
                           Sheets API (leer pestaña como tabla, respetando gid)
    google.ts              Server fns del login con Google: estado por usuario,
                           URL de consentimiento, canje del código (upsert de
                           usuario + crear sesión)
    authHelpers.ts         Helpers puros de sesión (token, hash, cookie,
                           dominio permitido) — con tests
    session.ts             SOLO servidor: sesiones en DB + cookie ttg_session;
                           requireUser()/AUTH_ERROR que usan todas las fns
    usersDb.ts             SOLO servidor: tabla users (upsert en login, tokens
                           Google por usuario)
    auth.ts                Server fns de sesión: meFn (sonda del guard de
                           rutas; devuelve id+email — el id clava el espejo
                           local del borrador), logoutFn
    draftsDb.ts            Server fns del borrador de trabajo por usuario:
                           getDraftFn/saveDraftFn sobre workspace_drafts
                           (una fila por usuario, upsert último-gana,
                           payload = el JSON del persist, tope 25 MB)
    googlePdf.ts           Server fn: HTML -> PDF/DOCX vía Google (sube cada
                           documento resuelto convertido a Google Doc temporal,
                           exporta los formatos pedidos, borra)
  state/workspaceStore.ts  Estado de la pantalla única (zustand + persist POR
                           USUARIO: espejo localStorage 'ttg-workspace:<id>'
                           síncrono + fila en DB con debounce — una recarga no
                           pierde trabajo y el borrador sigue a la cuenta en
                           cualquier navegador; skipHydration + rehidratación
                           en el layout _authed con el usuario de sesión y
                           bump de docToken para re-render del iframe)
  state/draftStorage.ts    Storage del persist del workspace: al hidratar gana
                           el más nuevo (espejo local vs DB) y el perdedor se
                           resincroniza; migra el borrador legacy
                           'ttg-workspace' una vez y borra espejos de OTROS
                           usuarios (privacidad en navegador compartido);
                           flush en pagehide y al cerrar sesión
  components/
    Home.tsx               Pantalla de inicio (ruta /) estilo Drive: "continuar
                           donde lo dejaste" (workspace autosaved), grid de
                           plantillas con miniatura + menú (abrir/duplicar/
                           renombrar/eliminar) y filtro por nombre
    SaveRecipeDialog.tsx   Diálogo "Guardar plantilla" del editor (nombre ->
                           saveRecipeFn, con miniatura)
    Workspace.tsx          El editor (ruta /editor). Orquestador: deriva la plantilla del HTML del editor
                           (buildTemplate bajo demanda), arma el plan y bloquea
                           Generar con mensajes claros si falta algo. Rehidrata
                           los stores persistidos, muestra la barra de estado
                           (pills 1·Plantilla / 2·Datos / 3·Campos + razón de
                           bloqueo inline), "Empezar de nuevo" con confirmación
                           y el Toast global (aria-live)
    RecipesMenu.tsx        "Mis plantillas": guardar la configuración actual con
                           nombre y recargarla en un clic (los datos se releen
                           del origen); eliminar con confirmación
    TopBar.tsx             Orígenes + agrupación + vista previa + Generar
    Palette.tsx            Chips de columnas y bloque Condición (draggables
                           nativos) + Repetir por fila
    GoogleConnect.tsx      Chip de cabecera: conectar / cuenta conectada /
                           desconectar
    DocCanvas.tsx          Iframe editable con el CSS original; inserción en
                           cursor, drop con caretRangeFromPoint, toggles de
                           data-*, envoltorio repetible multi-bloque, popovers
                           de vinculación de campos y de condición
    CondEditor.tsx         Popover de edición de una condición inline (ramas,
                           texto por defecto, Guardar/Eliminar)
    GenerateDialog.tsx     Modal de generación y descargas (elige vía Google o
                           local según la conexión); avisa en ámbar de columnas
                           usadas con celdas vacías (no bloquea: pueden ser
                           opcionales)
    PreviewFrame.tsx       Iframe sandbox de la vista previa
    ui.tsx                 Primitivos (Button, TextInput, ErrorNote, Spinner,
                           Pill, Toast, ConfirmDialog, useDialogChrome —
                           Escape + devolución de foco para todo diálogo)
```

**Clave de fidelidad:** un único renderizador basado en el **CSS original del Doc
sin modificar** (fuentes, márgenes de página, justificado y la clase de geometría
del `<body>`). El editor lo muestra en un `<iframe>` con `spellcheck="false"` (sin
subrayados del corrector); la vista previa y el PDF usan `resolve.ts` →
`buildDocumentHtml`, que envuelve el cuerpo con ese mismo CSS y `bodyClass` y solo
normaliza la página para impresión (los `padding` del Doc pasan a ser los márgenes
de la página). El **mismo HTML** alimenta preview y PDF, así que lo que se ve es lo
que se genera. Verificado: el PDF real sale idéntico al Doc importado (márgenes,
centrado, negrita, justificado); el spell-check de Chromium es solo de pantalla y
no llega al PDF.

**Saltos de página:** el `padding` del `<body>` (los márgenes del Doc) solo pega en
la 1ª y última página. En `server/pdf.ts` se lee ese padding y se convierte en
**margen real de `@page`** (`page.pdf({margin})`), que se repite en todas las
páginas; se mantiene el `max-width` del Doc para que el ajuste de línea —y por tanto
dónde caen los saltos— coincida con el original.

**Sincronización de paginación con el original (`template/pageSync.ts`, solo vía
local):** Google maqueta con su propio motor (Kix); Chromium rompe página en puntos
ligeramente distintos y la deriva se acumula. Solución: al cargar el Doc,
`fetchDocumentFn` baja también su **PDF export público** (la paginación exacta de
Google), extrae con pdfjs-dist el texto con el que empieza cada página y marca el
bloque correspondiente con el atributo `data-page-break="true"` (solo cuando la
página empieza en el límite de un bloque; si empieza a mitad de párrafo no se
fuerza, para no romper el justificado). Una regla
`@media print { [data-page-break] { break-before: page } }` en `resolve.ts` hace el
resto: la deriva se resetea en cada marca. El atributo viaja dentro del HTML por
todo el pipeline sin estado extra. Medido con un BOC real de 20 páginas: 10/19
inicios de página sincronizables automáticamente; resultado 20/20 páginas con los
mismos inicios que el original. Ya no hay botón manual de salto de página ni
marcador visual en el editor: la vía Google no lo necesita y la local se sincroniza
sola. `generateGooglePdfFn` quita estos atributos antes de subir a Google (Google
repagina por sí mismo).

**Fidelidad exacta (vía Google, implementada):** con cuenta conectada, cada
documento resuelto (campos sustituidos, condiciones evaluadas, repetibles
expandidos) se sube a Drive **convertido a un Google Doc temporal**, se exporta
como PDF (`files/{id}/export?mimeType=application/pdf`) y se borra el temporal.
Quien pagina es el propio Kix — el mismo motor que maquetó el original — así que
los saltos de página caen solos donde deben, incluso cuando los datos sustituidos
alargan o acortan párrafos. Nota de diseño: la idea inicial de `documents.batchUpdate`
+ `replaceAllText` sobre una **copia** del Doc no sirve con el lienzo Scratch — los
campos, condiciones y repetibles viven en el HTML editado **en la app**, no en el
Doc original, así que en la copia no habría nada que reemplazar. Subir el HTML
resuelto (que es el propio export HTML de Google, editado) conserva todas las
funciones del editor y deja la maquetación en manos de Google.

**Encabezados/pies repetidos (decisión de diseño):** cuando el Doc origen es la copia
de un boletín, sus líneas de encabezado/pie ("Boletín Oficial…", URL) vienen **en
línea** en el flujo, con sus propias clases (Times 7–9pt, alineación derecha/centro,
huecos vía `padding-top`). Se conservan **tal cual, inline** — así es exactamente como
las renderiza el documento original. Se probó extraerlas y repetirlas como pie real de
página (`displayHeaderFooter` de Chromium) y el resultado se parecía MENOS al original
(fuente/posición distintas y paginación desplazada), así que se revirtió.

**Vista previa centrada:** el HTML resuelto lleva en `frameStyles()` un bloque
`@media screen` (lienzo gris + `body{margin:16px auto !important}` + sombra)
para que el iframe de vista previa muestre una página centrada, como el editor.
No afecta al PDF: `server/pdf.ts` inyecta su propio override de márgenes
después (gana por orden) y el importador de Google ignora reglas de screen.

Aviso sobre `page.evaluate` en `server/pdf.ts`: se pasa como **string** para que el
bundler no inyecte helpers (p. ej. `__name` de esbuild) en el navegador. NUNCA meter
un regex `\s` dentro de ese string — el backslash no sobrevive y `/\s+/` pasa a
`/s+/`, que borra todas las letras "s". Normalizar texto en Node, con regex real.

## Puntos de extensión (preparados, no implementados)
- **API externa como origen de datos.** `ApiEndpointSource`
  (`src/lib/datasource/apiEndpointSource.ts`) es un *stub* con el contrato JSON
  esperado documentado. La UI ya permite elegir "API externa".
- ~~**Mapeo automático con IA.**~~ Implementado: `suggestMappingFn`
  (`src/server/aiMapping.ts`) llama a OpenAI (`gpt-5-mini`, salida JSON con
  schema estricto) con los tags SIN mapear, las columnas y hasta 5 filas de
  muestra truncadas a 60 caracteres (`src/lib/ai/mappingPrompt.ts`, helpers
  puros con tests). Requiere `OPENAI_API_KEY`; sin clave o ante cualquier
  fallo, el botón cae a la heurística por similitud de nombres
  (`src/lib/ai/suggestMapping.ts`) y avisa. `mergeMapping` nunca pisa una
  elección manual.

## Limitaciones de la fase actual

- Sin cuenta conectada, la lectura de plantilla y datos requiere enlaces
  **públicos** de Google ("cualquier persona con el enlace"). Con cuenta
  conectada (permiso de lectura) los privados accesibles por esa cuenta
  funcionan.
- La vía Google convierte el HTML resuelto de vuelta a Google Doc: conversión
  de ida y vuelta con los propios formatos de Google, pero no bit-perfecta
  (imágenes/elementos exóticos podrían diferir; el texto, tablas y estilos
  habituales se conservan).
- El origen "API externa" está conectado en la UI pero no lee datos todavía.
- Sin envío/publicación del resultado a otros sistemas.
- La lectura de la estructura del Doc depende del HTML exportado por Google; se
  preservan párrafos, encabezados, listas y tablas.

## Verificado

- Motor puro (parse → sustitución → condiciones → repetibles → agrupación) con
  campos partidos en varios `<span>` (caso típico de Google Docs).
- Condición inline a nivel documento (usa la primera fila del grupo) vs
  condición **dentro de una sección repetible → evaluada por fila**; el resumen
  del editor y el JSON `data-cond` nunca llegan al documento final; los
  `{{campos}}` escritos dentro de los textos de la condición cuentan para la
  detección y el aviso de vínculos.
- Envoltorio repetible multi-bloque: los bloques envueltos repiten juntos por
  fila; envolver/desenvolver desde la paleta.
- Generación de PDF con Playwright en el runtime del servidor (`%PDF-`,
  márgenes en todas las páginas, marcas `data-page-break` respetadas, el texto
  de la condición llega al PDF).
- Smoke de navegador sobre la pantalla única: insertar campo por clic y por
  drag & drop dentro del iframe, campo sin columna en ámbar + vinculación por
  popover, repetible mono y multi-bloque, condición inline (insertar por clic y
  por drop, editar, reabrir, eliminar), vista previa por fila y por grupo,
  generación y descarga reales, 0 errores de consola.
- Regresión con un BOC real de 20 páginas cargado por la UI: las marcas
  `data-page-break` llegan al editor (10) y el PDF generado mantiene las
  20 páginas del original.

## Notas de implementación

- El drag & drop paleta→documento es **HTML5 nativo** (dnd-kit no cruza
  iframes): la paleta pone la carga en `dataTransfer` (`text/ttg-column` para
  columnas, `text/ttg-cond` para el bloque Condición) y el canvas usa
  `doc.caretRangeFromPoint(x, y)` para insertar donde apunta el puntero
  (Chromium/WebKit; objetivo actual Chrome).
- `DocCanvas` NO persiste el body del iframe en el cleanup del efecto de
  inicialización: en un cambio de documento el cleanup corre ANTES de escribir
  el nuevo y machacaría el `editorHtml` recién cargado con el contenido viejo.
  Los listeners `input`/`focusout` ya persisten las ediciones.
- En contenteditable un clic puede dejar el caret **a nivel de BODY**
  (container = body, offset = índice de hijo), sobre todo tras mutaciones del
  DOM: `boundaryNode()` desciende al hijo correspondiente antes de buscar el
  bloque del cursor (si no, los toggles fallan en silencio).
- El JSON de la condición va **URI-encoded** en `data-cond` para que comillas y
  entidades no rompan el atributo ni en el DOM ni en node-html-parser;
  `decorateFields` no toca el texto dentro de `.ttg-cond` (es el resumen, no
  campos).
- `window.__ttgStore` (solo en dev) expone el store para los smoke tests de
  navegador sin depender de red. OJO en tests: esperar
  `waitForFunction(() => !!window.__ttgStore)` antes de clicar — el SSR pinta
  los botones antes de que React hidrate y adjunte los handlers.
- Accesibilidad (pase 2026-07-08, WCAG AA): botones solo-icono con aria-label,
  selects con aria-label, texto informativo mínimo `text-slate-500` (4.6:1),
  `focus-visible:ring` en botones, todos los diálogos/popovers con
  `role="dialog"` + Escape + devolución de foco (`useDialogChrome`). El interior
  del iframe contenteditable queda fuera del alcance del pase (limitación de la
  metáfora drag & drop).
- UX empleado recurrente: el workspace se autopersiste (recarga no pierde nada)
  y "Mis plantillas" guarda configuraciones completas. Las recetas congelan el
  HTML editado: si el Doc de Google cambia, hay que recargarlo y re-marcar (la
  fecha de guardado se muestra para detectarlo).
