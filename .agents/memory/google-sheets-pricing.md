---
name: Tarifario privado de Google Sheets
description: Criterio de sincronización y continuidad offline para los precios de venta.
---

Los precios de venta deben provenir del tarifario privado autorizado de Google Sheets; la aplicación conserva el último tarifario válido en el dispositivo y no elimina precios utilizables cuando una actualización falla.

**Why:** El trabajo de campo debe continuar sin conexión y la hoja no está publicada para acceso anónimo.

**How to apply:** Toda mejora que cambie la carga de precios debe mantener la lectura autenticada en el servidor, el mapeo por SKU y la caché local del último resultado válido.