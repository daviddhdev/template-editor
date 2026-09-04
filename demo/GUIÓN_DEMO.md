# Guion de demo interna

## Objetivo

Mostrar, en una historia corta y reconocible, cómo una plantilla visual se
combina con datos tabulares para preparar documentos personalizados. La demo
usa únicamente datos ficticios de seguimiento de incidencias y no pretende ser
una presentación comercial.

## Duración y formato

- El MP4 condensado dura 1:52. Con la narración sugerida y pausas para comentar,
  el recorrido está pensado para ocupar unos 3–5 minutos en directo.
- Vídeo: 16:9, 1920×1080, MP4 H.264 con audio ausente.
- Todos los rótulos están incrustados en español; el vídeo se entiende sin
  narración.

## Historia y escenas

| Orden | Escena | Qué se ve | Texto sugerido para presentar |
| --- | --- | --- | --- |
| 1 | Apertura | Editor con el parte de seguimiento y chips de campos. | «Partimos de un parte sencillo que queremos reutilizar para varios clientes.» |
| 2 | Plantilla | Título, cliente, fecha, bloque de incidencia y barra lateral de datos. | «La plantilla conserva su estructura visual. Los campos son piezas que después reciben valores.» |
| 3 | Vínculos | Se abre el vínculo de un campo y se ve la relación con una columna. | «Cada campo queda vinculado a una columna; no hay que copiar y pegar fila por fila.» |
| 4 | Condición | Se abre “Aviso de seguimiento” y aparece la regla Estado = Pendiente. | «Podemos declarar una condición: si el estado es Pendiente, mostramos un aviso; en otro caso, mostramos el texto alternativo.» |
| 5 | Repetición y grupos | Bloque marcado como repetible y selector “un documento por grupo”. | «Dos filas del mismo cliente alimentan un único documento y el bloque de incidencia se repite para cada fila.» |
| 6 | Vista previa | Documento resuelto para un cliente y cambio a otro grupo. | «Antes de generar, comprobamos el resultado y recorremos otro grupo para detectar errores pronto.» |
| 7 | Generación | Checklist con tres documentos y progreso del flujo de generación. | «La herramienta prepara un documento por cliente; el progreso permite saber qué terminó.» |
| 8 | Resultado | Tres filas terminadas y botones PDF. | «El resultado queda disponible para descargar como PDF. La vista previa y la generación parten del mismo HTML resuelto.» |

## Notas para quien presenta

- Explicar desde el principio que la insignia “DEMO INTERNA · SIN DATOS REALES”
  identifica un entorno local sembrado con datos ficticios.
- Si la vista previa tarda, mantener el cursor quieto y comentar la diferencia
  entre cambiar de grupo y editar la plantilla; no rellenar silencios con
  información inventada.
- Si el progreso tarda, esperar a que las tres filas queden en “Listo”. El
  harness de captura intercepta la llamada local `generatePdfFn` y renderiza
  estos PDFs en su propio Chromium; es suficiente para enseñar el flujo.
- La conexión con Google Drive/Google Sheets y el login con Google no se
  realizan en esta demo. La fuente “API externa” es una extensión preparada en
  la aplicación, no una integración que debamos presentar como terminada.
- No mostrar consola, `.env`, cookies, cuentas ni URLs privadas durante una
  presentación en vivo.

## Regeneración

1. Arrancar el servidor de desarrollo con el modo de demo explícito:

   ```powershell
   $env:NODE_ENV='development'
   $env:TTG_DEMO_MODE='1'
   node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3000
   ```

2. En otra terminal, ejecutar:

   ```powershell
   node demo/capture.mjs
   ffmpeg -y -i demo/output/raw/<video>.webm -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p" -c:v libx264 -preset medium -crf 20 -movflags +faststart -an demo/output/demo-generador-documentos.mp4
   ```

El script escribe los fotogramas de control y deja el nombre del WebM en
`demo/output/raw-video-path.txt`. El servidor debe seguir ejecutándose con
`TTG_DEMO_MODE=1` para abrir el editor autenticado localmente; durante la
captura, el harness intercepta `generatePdfFn` y renderiza en su propio
Chromium. La guarda exige además `NODE_ENV=development` y no se activa en
producción.
