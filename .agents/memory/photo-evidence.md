---
name: Evidencias fotográficas
description: Persistencia y reintentos de fotos de ventas y marcaciones.
---

Las imágenes se guardan como archivos reales en la carpeta Fotos de Google Drive. Mientras no haya conexión permanecen como blobs en IndexedDB; tras la carga, el enlace de Drive reemplaza el nombre provisional en el registro y se sincroniza con la BBDD.

**Why:** localStorage y Google Sheets no son adecuados para almacenar imágenes binarias o base64, especialmente desde teléfonos y con conectividad intermitente.

**How to apply:** Mantener la cola binaria fuera de localStorage, reintentar al recuperar conexión y asociar cada archivo mediante tipo de entidad, ID del registro y campo de evidencia.