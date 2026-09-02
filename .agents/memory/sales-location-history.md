---
name: Ubicación histórica de ventas
description: Criterio para conservar y analizar la ubicación del mercado en cada venta.
---

Cada venta debe guardar Región, Departamento, Provincia y Distrito como una copia histórica de la ubicación del mercado al momento del registro. Los análisis y exportaciones deben usar primero esos campos y consultar el catálogo actual solo como respaldo para registros antiguos.

**Why:** Si la ficha de un mercado cambia después, recalcular la ubicación desde el catálogo alteraría retrospectivamente los reportes históricos.

**How to apply:** Al crear una venta, copiar los cuatro niveles geográficos del mercado seleccionado. Al leer ventas antiguas sin esos campos, completarlos una sola vez desde el mercado relacionado y sincronizar el resultado.