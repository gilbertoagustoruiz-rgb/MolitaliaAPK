---
name: Evidencias fotográficas
description: Persistencia y reintentos de fotos de ventas y marcaciones.
---

Las imágenes intentan guardarse como archivos reales en la carpeta Fotos de Google Drive. Si el conector no está disponible en producción, App Storage es el respaldo persistente. Mientras no haya conexión permanecen como blobs en IndexedDB; tras una carga confirmada, la URL reemplaza el nombre provisional y se sincroniza con la BBDD.

**Why:** localStorage y Google Sheets no son adecuados para almacenar imágenes binarias o base64, y los conectores OAuth personales pueden no estar disponibles dentro del proceso publicado.

**How to apply:** Mantener la cola binaria fuera de localStorage, reintentar al recuperar conexión y periódicamente mientras haya red, e intentar App Storage cuando Drive rechace la carga. No retirar una foto de la cola hasta que algún almacenamiento persistente confirme éxito.

Cada archivo debe incluir cliente y mercado en el nombre, la descripción y las propiedades de Drive.

**Why:** El ID operativo por sí solo no permite reconocer rápidamente la evidencia al revisar la carpeta, y un fallo silencioso puede hacer creer que la fotografía ya está respaldada.

**How to apply:** Enviar cliente, mercado y tipo de registro junto al binario; incluirlos en el nombre del objeto y solo reemplazar el valor provisional por la URL después de recibir confirmación de Drive o App Storage.

Los enlaces `drive.google.com/file/d/.../view` son enlaces de página, no fuentes válidas para una etiqueta de imagen; las miniaturas deben usar una URL directa de thumbnail o descarga.

**Why:** Una vista de Drive puede abrirse como página en el navegador, pero una miniatura `<img>` la interpreta como contenido de imagen y falla.

**How to apply:** Detectar el ID del archivo en enlaces históricos de Drive, convertirlo a `thumbnail`, y conservar el enlace original como alternativa para abrir el archivo completo.