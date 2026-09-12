# Seguimiento del feedback funcional

Documento de seguimiento para el piloto corporativo interno con Google. Recoge el alcance acordado y la evidencia necesaria para validar el feedback; no certifica funcionalidades terminadas. Las secciones relacionadas de [`TODO.md`](TODO.md) son antecedentes de trabajo: [Bugs / comprobaciones pendientes](TODO.md#bugs--comprobaciones-pendientes), [Multiusuario](TODO.md#multiusuario-confirmado-la-app-será-multiusuario), [roadmap por prioridad de negocio](TODO.md#features-roadmap-por-prioridad-de-negocio) y [test de usabilidad del 2026-07-12](TODO.md#features-test-de-usabilidad-2026-07-12-persona-departamento-legal). Las casillas o notas de `TODO.md` no sustituyen la verificación indicada aquí.

La plantilla de referencia para las pruebas de fidelidad es `C:/Users/Usuario/Downloads/F.I.G.COMERCIAL.SOLICITUD_DED_IDi.06.26(2).docx`. Se referencia por su nombre y ruta únicamente; no se copia ni se versiona en este repositorio.

## Índice de los 18 puntos originales

El primer punto llegó sin número y se conserva así para no cambiar la referencia del feedback.

| Ref. | Punto original | Bloque | Estado de seguimiento |
|---|---|---:|---|
| Sin número | Combinar If/For - For/If | 5 | Definido |
| 1 | Seleccionar texto y aplicar una variable en varias coincidencias | 5 | Definido |
| 2 | Versionado automático | 3 | Definido |
| 3 | Roles | 2 | Definido |
| 4 | Separar editar, ver, generar e historial con autor | 2 | Definido |
| 5 | Log | 3 | Definido |
| 6 | Seguridad | 2 | Definido |
| 7 | Arreglar «Rellenar» | 1 | Definido |
| 8 | Word y estilos avanzados | 1 | Definido |
| 9 | Salesforce | 6 | Futuro |
| 10 | Nuevas fuentes y subida | 5 | Definido |
| 11 | Live preview | 5 | Definido |
| 12 | DocuSign | 6 | Futuro |
| 13 | Generar, guardar separado y exportar | 4 | Definido |
| 14 | Plataforma como fuente de verdad: Drive/OneDrive | 4 | Definido |
| 15 | Formularios y tablas | 1 | Definido |
| 16 | Clientes y branding | 6 | Futuro |
| 17 | Que funcione bien | Transversal | Definido |

Los puntos activos parten de `Definido`; las líneas futuras permanecen en `Futuro`. No se usa `Completado` en este documento. Una implementación parcial, una anotación en `TODO.md` o un informe sin reproducción no cierra un punto.

**Leyenda de estados:** `Por concretar` = alcance todavía abierto; `Definido` = alcance acordado, pendiente de ejecución y validación; `En curso` = trabajo iniciado en una actualización posterior; `Pendiente de validación` = ejecución declarada y evidencia final pendiente; `Completado` = criterios y evidencia cerrados; `Futuro` = reservado para una fase posterior. En esta versión, todos los puntos activos están en `Definido` y todos los futuros en `Futuro`.

## 1. Bloque piloto: bloqueadores de Rellenar, Word y formularios

### Punto 7 — Arreglar «Rellenar»

- **Prioridad:** P0, bloqueador del piloto.
- **Estado:** Definido.
- **Alcance acordado:** Corregir el caso en que los campos vacíos se comportan de forma incoherente: la vista previa muestra valores antiguos, los marcadores dejan de verse o escribir no sustituye el marcador. Un campo vacío debe mostrar `{{VARIABLE}}`; al escribir, debe sustituirse el marcador; al borrar el valor, debe poder restaurarse el marcador vacío. La causa actual sigue sin diagnosticar.
- **Criterios de aceptación:** En una plantilla cargada con campos vacíos, la edición y la vista previa representan el mismo estado; `{{VARIABLE}}` permanece visible hasta que se escribe un valor; limpiar el valor permite volver al marcador; guardar y reabrir conserva el estado; la solución no altera otras variables, reglas ni tablas.
- **Dependencias:** Acceso al flujo «Rellenar» y a la plantilla de referencia. La validación final se relaciona con los puntos 8, 13 y 17; el diagnóstico no depende de los puntos 2–4.
- **Evidencia de validación:** Pendiente. **Informe de usuario:** al abrir o rellenar hay campos vacíos cuya vista previa conserva valores antiguos. **Verificación técnica:** pendiente de aislar la causa y reproducirla con la matriz de pruebas.

### Punto 8 — Word y estilos avanzados

- **Prioridad:** P0, bloqueador de fidelidad del piloto.
- **Estado:** Definido.
- **Alcance acordado:** Mantener, al editar texto o insertar variables, tamaño, color, fuente, negrita, cursiva y subrayado, también cuando el estilo corresponde a una variable. La plantilla de referencia debe conservar la cabecera con rectángulo azul, texto a la izquierda y logo a la derecha. Las tablas que funcionan como formularios deben conservar estilos, celdas combinadas y distribución visual. No se requieren controles interactivos de Word.
- **Criterios de aceptación:** Un documento sin cambios exporta fielmente; editar texto o insertar variables conserva la composición y los estilos en Word y PDF; el editor puede seguir mostrando la plantilla; tablas, celdas combinadas, márgenes y cabecera mantienen su posición; cualquier conversión aproximada se identifica y bloquea la afirmación de fidelidad.
- **Dependencias:** Plantilla de referencia y rutas de exportación. La validación se relaciona con los puntos 7, 13, 15 y 17.
- **Evidencia de validación:** Pendiente. **Informe de usuario:** la edición de `TEXT` o la inserción de variables rompe únicamente las exportaciones Word/PDF; el editor sigue bien y un documento sin editar exporta bien. **Verificación técnica:** pendiente de ejecutar pruebas con la plantilla indicada, comparando documento sin cambios, edición de texto, inserción de variables, guardado, reapertura y ambos formatos.

### Punto 15 — Formularios y tablas

- **Prioridad:** P0, bloqueador del piloto legal.
- **Estado:** Definido.
- **Alcance acordado:** Permitir rellenar formularios visuales construidos con texto y tablas, conservando estilos, celdas combinadas, tamaños, bordes, márgenes y distribución. Los campos siguen siendo variables editables del documento. El alcance no incluye controles interactivos nativos de Word, campos de formulario OOXML ni OCR o extracción automática de documentos.
- **Criterios de aceptación:** Un formulario con tablas y celdas combinadas se puede cargar, editar, rellenar, guardar, reabrir y exportar a Word y PDF sin perder su estructura visual; los valores se ven en la celda correcta; los campos vacíos siguen el contrato del punto 7; la comparación cubre una tabla sin cambios, cambios de texto y variables.
- **Dependencias:** Editor, rutas de exportación y plantilla de referencia. La validación se relaciona con los puntos 7, 8, 10, 13 y 17.
- **Evidencia de validación:** Pendiente. **Informe de usuario:** se necesita conservar la apariencia de formularios y tablas del documento de referencia. **Verificación técnica:** pendiente de una prueba e2e con tablas, estilos y celdas combinadas en ambos formatos.

## 2. Bloque interno: seguridad, equipos y permisos

El piloto será interno y corporativo, con Google. La comercialización queda para una fase posterior, después de revisar los controles de seguridad y propiedad.

### Punto 3 — Roles

- **Prioridad:** P0, requisito de gobierno del piloto.
- **Estado:** Definido.
- **Alcance acordado:** En el piloto hay varios equipos departamentales (Legal, Operaciones, Comercial, etc.). Cada usuario pertenece a un único equipo y tiene un único rol: administrador, editor o consulta y generación. El administrador crea equipos, asigna a cada usuario su equipo y rol y dispone de acceso global a todas las acciones. El editor crea plantillas y duplica variantes, edita, rellena y genera; puede consultar las salidas, historial y log de su equipo, pero no borrar plantillas. Consulta y generación ve las plantillas del equipo y sus propias salidas e historial, y no puede rellenar. Cuando un usuario cambia de equipo, los documentos, plantillas e historial permanecen en el equipo original y conservan su autoría; el usuario pierde el acceso al equipo anterior.
- **Criterios de aceptación:** Cada combinación de usuario, equipo y rol produce exactamente los permisos acordados; un usuario no puede usar una acción restringida cambiando la interfaz o llamando directamente al servidor; un editor puede duplicar una plantilla para crear una variante; un cambio de equipo conserva los activos en el equipo original, mantiene la autoría y revoca el acceso anterior; el administrador puede auditar y corregir asignaciones.
- **Dependencias:** Autenticación, pertenencia a equipo y propiedad; puntos 4, 5 y 6 para acciones, registro y enforcement. La validación se relaciona con el punto 17.
- **Evidencia de validación:** Pendiente. **Informe de usuario:** se solicita una biblioteca compartida de equipo con roles y un cambio de equipo que conserve los activos en el equipo original. **Verificación técnica:** pendiente de matriz de permisos e2e con administrador, editor y consulta/generación, incluyendo cambio de equipo y acceso por servidor.

### Punto 4 — Separar editar, ver, generar e historial con autor

- **Prioridad:** P0, requisito de operación y auditoría.
- **Estado:** Definido.
- **Alcance acordado:** La interfaz presenta acciones separadas y explícitas: `Editar`, `Rellenar`, `Generar` e `Historial`. Las vistas muestran el autor y el equipo de cada plantilla, documento, versión y generación. El servidor aplica la misma separación y no confía en que la interfaz oculte botones.
- **Criterios de aceptación:** Cada acción abre solo el flujo permitido por el rol; una URL o llamada directa a otra acción recibe rechazo del servidor; el historial identifica autor, fecha, plantilla, equipo y resultado; editar una variante no mezcla su autoría con la plantilla original.
- **Dependencias:** Rol y pertenencia de equipo del punto 3, enforcement del punto 6 y datos de autoría de los puntos 2, 5 y 13.
- **Evidencia de validación:** Pendiente. **Informe de usuario:** se pide distinguir editar, ver, generar e historial y hacer visible quién creó cada elemento. **Verificación técnica:** pendiente de revisar la navegación, permisos server-side y datos de autor en un flujo completo por rol.

### Punto 6 — Seguridad

- **Prioridad:** P0 antes de ampliar el piloto.
- **Estado:** Definido.
- **Alcance acordado:** Revisar antes del piloto interno el cifrado del refresh token en reposo, el sandbox del iframe del editor, la red del Chromium que genera PDFs y las protecciones de ownership. Mantener controles contra SSRF/allowlist, aislar datos entre usuarios y equipos y evitar que una exportación o fuente externa pueda escribir fuera del ámbito autorizado. Las decisiones de comercialización se posponen hasta cerrar esta revisión.
- **Criterios de aceptación:** Refresh tokens cifrados y no expuestos al cliente; editor con sandbox revisado; red del proceso PDF bloqueada o limitada a una allowlist justificada; todas las lecturas y escrituras filtran por usuario/equipo/propiedad; accesos cruzados, URLs externas no permitidas y cambios de rol quedan rechazados y registrados; existe una revisión documentada para el entorno Google interno.
- **Dependencias:** Autenticación, sesiones y ownership; puntos 3 y 4; log del punto 5; exportación del punto 13; decisiones de infraestructura del piloto.
- **Evidencia de validación:** Pendiente. **Informe de usuario:** se requiere revisar la seguridad antes del uso corporativo. **Antecedente de repositorio:** la sección [Multiusuario de `TODO.md`](TODO.md#multiusuario-confirmado-la-app-será-multiusuario) enumera token en reposo, sandbox del editor, red de PDF y ownership para revisar. **Verificación técnica:** pendiente de auditoría de configuración, pruebas negativas de autorización/SSRF y comprobación en el despliegue del piloto.

## 3. Bloque de persistencia: versionado automático y log

### Punto 2 — Versionado automático

- **Prioridad:** P1, protección de trabajo y trazabilidad.
- **Estado:** Definido.
- **Alcance acordado:** El guardado automático de trabajo es independiente de los snapshots automáticos: cada minuto se crea un snapshot solo si hubo cambios, sin generar uno por cada pulsación. Las variantes siguen siendo editables y cada una mantiene su propio historial. Un snapshot contiene contenido, estilos, variables, reglas y configuración de la fuente; no contiene datos externos obtenidos en una ejecución. Cada snapshot muestra fecha, autor y diferencia. Restaurar añade un nuevo estado al historial y conserva los estados posteriores.
- **Criterios de aceptación:** Cambiar y guardar una variante genera un snapshot cada minuto como máximo cuando hay cambios; no se generan snapshots de tecleo sin cambio persistible; una variante puede editarse después de un snapshot; la comparación identifica contenido, estilos, variables, reglas y configuración de fuente; restaurar no borra historial posterior ni cambia datos externos ya generados; las versiones existentes se migran sin perder contenido y el formato de diff queda documentado antes de cerrar la fase.
- **Dependencias:** Persistencia de borradores, ownership y roles; punto 4 para mostrar historial y autor; punto 5 para auditar creación/restauración; punto 13 para mantener documentos generados fijos.
- **Evidencia de validación:** Pendiente. **Informe de usuario:** se pide versionado automático, variantes editables con historial propio y restauración trazable. **Verificación técnica:** pendiente de decidir y ejecutar la migración de versiones existentes, formato del diff, temporización del snapshot y restauración con historial posterior.

### Punto 5 — Log

- **Prioridad:** P1, auditoría del piloto.
- **Estado:** Definido.
- **Alcance acordado:** Registrar creación, edición, restauración, generación, exportación, eliminación y cambios de usuario, rol o equipo. El administrador ve el log global; el editor ve los eventos de su equipo según sus permisos. Cada evento identifica actor, autoría, equipo, fecha, objeto afectado, resultado y, cuando aplique, versión o documento generado. El log debe ser append-only para los hechos de negocio.
- **Criterios de aceptación:** Cada acción incluida produce un evento idempotente y consultable; no se puede alterar un evento desde la interfaz; los filtros por equipo, usuario, plantilla y fecha respetan ownership; un error queda distinguido de una acción exitosa; el historial y el log no inventan autoría ni pierden una restauración o exportación.
- **Dependencias:** Puntos 3 y 4 para visibilidad; punto 2 para versiones; punto 6 para integridad y ownership; punto 13 para documentos generados.
- **Evidencia de validación:** Pendiente. **Informe de usuario:** se solicita un log que cubra las acciones de documentos y los cambios de personas/equipos. **Verificación técnica:** pendiente de una secuencia e2e que ejercite los siete grupos de eventos y compruebe visibilidad por rol.

## 4. Bloque documentos: guardar separado, exportar y fuente de verdad

### Punto 13 — Generar, guardar separado y exportar

- **Prioridad:** P1, requisito operativo.
- **Estado:** Definido.
- **Alcance acordado:** Cada documento generado se guarda como resultado fijo dentro de la plataforma, separado de la plantilla, variante y snapshot que lo originaron. Consulta y generación puede descargar Word o PDF ya almacenado sin regenerarlo. Si se seleccionó una carpeta de Drive, se reutiliza para copiar/exportar los resultados; un cambio posterior en la fuente no modifica ni reescribe documentos generados y las copias externas no escriben de vuelta en el documento almacenado.
- **Criterios de aceptación:** Una generación crea un documento identificable con plantilla, versión, autor, fecha y datos de ejecución; descargar Word/PDF no vuelve a consultar la fuente ni altera el documento; cambiar o recargar la fuente deja intacto el resultado almacenado; Drive recibe una copia en la carpeta elegida sin convertirla en fuente de escritura; errores de copia no borran el resultado de plataforma.
- **Dependencias:** Puntos 2, 4, 5, 8 y 14; permisos de Drive del usuario; almacenamiento de documentos y pruebas de exportación del punto 17.
- **Evidencia de validación:** Pendiente. **Informe de usuario:** se necesita separar generación y guardado del documento final para descargarlo sin regenerar. **Verificación técnica:** pendiente de probar generación, cambio de fuente, descarga posterior y copia a Drive sin writeback.

### Punto 14 — Plataforma como fuente de verdad: Drive/OneDrive

- **Prioridad:** P1, requisito de integridad documental.
- **Estado:** Definido.
- **Alcance acordado:** La plataforma conserva las plantillas, sus versiones y los documentos generados como fuente de verdad de los resultados almacenados. La carpeta de salida de Drive ya seleccionada se reutiliza para hacer copias o exportar; los cambios externos en Drive no escriben de vuelta en los resultados de la plataforma. OneDrive queda como extensión futura. La frescura y la preview de Drive/Sheets se siguen en el punto 11.
- **Criterios de aceptación:** El documento generado almacenado en la plataforma permanece fijo; una descarga posterior devuelve ese resultado sin regenerarlo; Drive recibe copias en la carpeta seleccionada; modificar una copia o la fuente externa no cambia el resultado almacenado ni escribe de vuelta; OneDrive no se presenta como disponible en esta fase.
- **Dependencias:** Almacenamiento y exportación del punto 13, ownership del punto 6 y registro del punto 5. La validación de frescura se relaciona con el punto 11.
- **Evidencia de validación:** Pendiente. **Informe de usuario:** se solicita que la plataforma sea la fuente de verdad y que Drive permita reutilizar la carpeta para copias/exportación; OneDrive queda para después. **Verificación técnica:** pendiente de probar documento almacenado, descarga sin regenerar, copia a Drive y ausencia de writeback.

## 5. Bloque de mejoras: fuentes, variables, If/For y vista previa

### Punto 10 — Nuevas fuentes y subida

- **Prioridad:** P2, ampliación del piloto.
- **Estado:** Definido.
- **Alcance acordado:** Permitir subir un DOCX local como plantilla cuando actúe un administrador o editor. La subida no extrae datos, no hace OCR y no trata DOCX/PDF como fuentes de datos. Se conservan como fuentes de datos Excel, Sheets y API, con sus configuraciones y permisos propios. Las nuevas fuentes adicionales se evalúan por separado en el bloque futuro.
- **Criterios de aceptación:** Un administrador o editor puede subir un DOCX, guardarlo como plantilla y versionarlo; consulta y generación no pueden subir ni convertirlo en plantilla; el archivo no se procesa como dataset ni se extraen campos automáticamente; las fuentes Excel, Sheets y API existentes siguen disponibles sin regresión; el origen usado queda en la configuración y el log.
- **Dependencias:** Puntos 3 y 6 para permisos y seguridad; puntos 2 y 14 para versionado y fuente de verdad; parser/editor del punto 8; validación transversal del punto 17.
- **Evidencia de validación:** Pendiente. **Informe de usuario:** se solicitan nuevas fuentes y subida, manteniendo Excel, Sheets y API y sin extracción/OCR de DOCX/PDF. **Verificación técnica:** pendiente de prueba por rol, comprobación de que no hay extracción de datos y regresión de las tres fuentes existentes.

### Punto 1 — Seleccionar texto y aplicar una variable en varias coincidencias

- **Prioridad:** P2, mejora de productividad.
- **Estado:** Definido.
- **Alcance acordado:** Buscar coincidencias exactas, sensibles a mayúsculas, minúsculas y acentos, en todo texto editable, incluidas celdas de tablas. Excluir variables ya existentes. `Ctrl+D` añade la siguiente coincidencia a la selección acumulada; seleccionar todas las coincidencias de una misma variable conserva el formato local de cada aparición.
- **Criterios de aceptación:** Solo se seleccionan coincidencias con la misma grafía y acentuación; el texto dentro de `{{VARIABLE}}` no se vuelve a envolver; `Ctrl+D` añade la siguiente coincidencia a la selección acumulada; aplicar una variable a varias apariciones no homogeneiza fuente, tamaño, color, negrita, cursiva ni subrayado locales; el comportamiento es igual en párrafos y tablas editables.
- **Dependencias:** Modelo de variables y editor del punto 7; estilos del punto 8; tablas del punto 15; auditoría de edición del punto 5.
- **Evidencia de validación:** Pendiente. **Informe de usuario:** se pide resolver varias coincidencias de un texto seleccionado manteniendo el formato de cada una. **Verificación técnica:** pendiente de casos con acentos, mayúsculas, texto en tablas, variables preexistentes y formatos distintos.

### Punto sin número — Combinar If/For - For/If

- **Prioridad:** P2, mejora de expresividad.
- **Estado:** Definido.
- **Alcance acordado:** Definir combinaciones y anidamiento `For/If`: `For → If` aplica por fila y `If → For` usa un campo común de grupo para gobernar la repetición, con `else` existente opcional. Admitir tamaño, color, fuente, negrita, cursiva y subrayado en el texto formateado, incluidas variables. Quedan fuera tablas y secciones de varios bloques; el texto multilínea dentro de un único bloque sigue dentro del alcance.
- **Criterios de aceptación:** El anidamiento por fila aplica la condición a la fila correcta; el anidamiento por grupo usa un campo común y no duplica ni omite filas; una repetición puede quedar habilitada o deshabilitada de forma visible; `else` existente se conserva; formato y variables sobreviven en cada rama, incluido el texto multilínea de un único bloque. Tablas y secciones de varios bloques quedan fuera del alcance.
- **Dependencias:** Motor de reglas, agrupación por fila, editor de variables y estilos de los puntos 1, 7 y 8. La validación se relaciona con el punto 2; las tablas del punto 15 no se incluyen dentro de estas combinaciones.
- **Evidencia de validación:** Pendiente. **Informe de usuario:** se solicita combinar estructuras If/For para condicionar repeticiones y conservar formato. **Verificación técnica:** pendiente de probar filas, grupos, `else`, variables, estilos y texto multilínea de un único bloque; tablas y secciones de varios bloques están fuera del alcance.

### Punto 11 — Live preview

- **Prioridad:** P2, confianza de edición.
- **Estado:** Definido.
- **Alcance acordado:** Priorizar la frescura de Google Sheets en la vista previa: la actualización automática de datos y preview es deseable. Como mínimo, debe detectar y avisar si Sheets o Drive están desactualizados. Recargar una plantilla desde Drive requiere confirmación explícita para proteger las ediciones locales. La vista previa no modifica los documentos generados ya almacenados.
- **Criterios de aceptación:** Un cambio externo detectable en Sheets o Drive produce un aviso de fuente desactualizada; si se habilita la actualización automática de Sheets, la preview muestra el cambio y el aviso correspondiente; recargar una plantilla de Drive pide confirmación antes de reemplazar ediciones locales; la preview no altera un resultado generado.
- **Dependencias:** Conectores y metadatos de Drive/Sheets, además de la vista previa. La relación con el punto 14 se limita a la señal de frescura; la preservación de resultados queda allí.
- **Evidencia de validación:** Pendiente. **Informe de usuario:** se solicita live preview y se considera deseable el auto-refresh de Sheets. **Verificación técnica:** pendiente de probar aviso mínimo de cambios en Sheets y Drive, actualización de Sheets si se habilita y confirmación al recargar Drive.

## 6. Bloque futuro: Salesforce, DocuSign, OneDrive/otras fuentes y branding

Estas líneas requieren decisiones de producto, seguridad y conectores antes de entrar en el alcance del piloto.

### Punto 9 — Salesforce

- **Prioridad:** P3, futuro.
- **Estado:** Futuro.
- **Alcance acordado:** Evaluar si Salesforce encaja como fuente de datos. No se implementa ni se promete una integración en esta fase.
- **Criterios de aceptación:** Existe una evaluación documentada y una decisión sobre si pasa a una fase posterior; no se presenta una prueba futura como funcionalidad disponible.
- **Dependencias:** Relación con los puntos 6, 10, 14 y 17 si la evaluación se retoma.
- **Evidencia de validación:** Pendiente. **Informe de usuario:** Salesforce figura como fuente futura deseada. **Verificación técnica:** evaluación pendiente; no existe integración validada.

### Punto 12 — DocuSign

- **Prioridad:** P3, futuro.
- **Estado:** Futuro.
- **Alcance acordado:** Evaluar si DocuSign encaja para enviar documentos generados y seguir su estado de firma. No se implementa ni se promete un envío en esta fase.
- **Criterios de aceptación:** Existe una evaluación documentada y una decisión sobre si pasa a una fase posterior; no se presenta una integración futura como funcionalidad disponible.
- **Dependencias:** Relación con los puntos 5, 6 y 13 si la evaluación se retoma.
- **Evidencia de validación:** Pendiente. **Informe de usuario:** DocuSign se solicita como capacidad futura. **Verificación técnica:** evaluación pendiente; no hay envío validado.

### Punto 16 — Clientes y branding

- **Prioridad:** P3, futuro comercial.
- **Estado:** Futuro.
- **Alcance acordado:** Evaluar branding por cliente, al menos nombre, logo y colores. La comercialización se considera después del piloto corporativo interno.
- **Criterios de aceptación:** Existe una evaluación documentada y una decisión sobre si pasa a una fase posterior; no se presenta branding multiempresa como funcionalidad disponible.
- **Dependencias:** Relación con los puntos 3, 4, 6, 2 y 13 si la evaluación se retoma.
- **Evidencia de validación:** Pendiente. **Informe de usuario:** se pide preparar branding para clientes con nombre, logo y colores. **Verificación técnica:** evaluación pendiente; no existe validación comercial.

### Extensión futura del punto 14 — OneDrive y otras fuentes

- **Prioridad:** P3, posterior al piloto.
- **Estado:** Futuro.
- **Alcance acordado:** Evaluar OneDrive y otras fuentes como una fase posterior. La extensión no cambia el alcance acordado para Drive y no se trata como una implementación existente.
- **Criterios de aceptación:** Existe una evaluación documentada y una decisión sobre si alguna fuente pasa a una fase posterior; no se presenta ningún conector futuro como funcionalidad disponible.
- **Dependencias:** Relación con los puntos 6, 10, 13 y 14 si la evaluación se retoma.
- **Evidencia de validación:** Pendiente. **Informe de usuario:** OneDrive y otras fuentes se consideran una evolución posterior. **Verificación técnica:** pendiente de evaluación comparativa y no iniciada.

## 7. Punto transversal 17 — Que funcione bien

- **Prioridad:** P0 transversal al piloto.
- **Estado:** Definido.
- **Alcance acordado:** Validar flujos reales completos y repetibles: cargar plantilla y fuente, editar texto, insertar variables, rellenar, revisar preview, guardar/reabrir, generar, exportar Word/PDF, consultar historial/log y descargar resultados. La calidad incluye fidelidad visual, datos correctos, permisos, mensajes comprensibles, rendimiento suficiente y ausencia de pérdida de trabajo.
- **Criterios de aceptación:** Los flujos de usuario del piloto se completan con datos reales anonimizados y roles reales; las pruebas cubren documento sin cambios, edición de texto, variables, tablas/formularios, estilos, guardado, reapertura y ambos formatos; los errores son visibles y recuperables; no se marca un punto como terminado por estar documentado o parcialmente implementado; cada criterio tiene evidencia reproducible y responsable de validación.
- **Dependencias:** Todos los puntos, especialmente 3, 4, 6, 7, 8, 13, 14 y 15; plantilla de referencia; entorno Google corporativo interno.
- **Evidencia de validación:** Pendiente. **Informe de usuario:** la expectativa transversal es que los flujos funcionen de forma fiable para el trabajo legal. **Verificación técnica:** pendiente de ejecutar la matriz e2e, pruebas por rol, comparaciones Word/PDF y revisión de regresiones.

## Registro ligero de trabajo documentado

| Fecha | Trabajo | Resultado |
|---|---|---|
| 2026-09-12 | Creación de `SEGUIMIENTO_FEEDBACK.md` con índice, alcance agrupado, criterios y plan de validación. | Documento de seguimiento creado; ninguna funcionalidad se marca como completada. |
