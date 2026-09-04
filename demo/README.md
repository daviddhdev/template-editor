# Demo interna del generador

La captura final está en [output/demo-generador-documentos.mp4](output/demo-generador-documentos.mp4).
El guion y las contingencias están en [GUIÓN_DEMO.md](GUIÓN_DEMO.md). La
grabación usa cuatro filas ficticias de seguimiento, agrupadas por cliente, y
no realiza login ni llamadas a Google.

El MP4 dura 1:52, está codificado en H.264 a 1920×1080 y no tiene audio. Los
rótulos permiten reproducirlo solo o acompañarlo con el guion durante unos
3–5 minutos de presentación en directo.

## Reproducir

```powershell
ffplay demo/output/demo-generador-documentos.mp4
```

## Regenerar

Con Postgres/Docker apagado, activar el modo local explícito y arrancar Vite:

```powershell
$env:NODE_ENV='development'
$env:TTG_DEMO_MODE='1'
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3000
```

En otra terminal:

```powershell
node demo/capture.mjs
$raw = Get-Content demo/output/raw-video-path.txt
ffmpeg -y -i $raw -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p" -c:v libx264 -preset medium -crf 20 -movflags +faststart -an demo/output/demo-generador-documentos.mp4
```

La captura corre Playwright a 1920×1080, incrusta captions en español y
renderiza los PDFs ficticios dentro del harness local para que el servidor no
necesite un segundo navegador hijo en entornos restringidos. La identidad demo
permite abrir el editor autenticado en local; el harness intercepta únicamente
`generatePdfFn` y renderiza en su propio Chromium, por lo que esta captura no
ejercita `src/server/pdf.ts` ni su navegador interno. La guarda de sesión demo
solo funciona cuando `NODE_ENV=development` y `TTG_DEMO_MODE=1`; la
autenticación de producción permanece intacta.

Limitaciones honestas: esta sesión no puede conectarse a Google Drive/Sheets
ni al login OAuth. El selector «API externa» se muestra como extensión
preparada en la aplicación, no como integración terminada.
