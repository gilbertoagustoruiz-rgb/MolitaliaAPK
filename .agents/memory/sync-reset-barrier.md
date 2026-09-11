---
name: Limpieza sincronizada de catálogos
description: Protección contra la resurrección de registros borrados por snapshots offline antiguos.
---

Cuando una limpieza administrativa elimina catálogos compartidos, no basta con borrar PostgreSQL: una pestaña antigua puede enviar su snapshot local y volver a insertar mercados, clientes o canjes.

**Why:** La PWA conserva estado local y el service worker puede servir una versión anterior durante un tiempo; la sincronización normal no distingue una edición válida de un snapshot obsoleto después de una limpieza definitiva.

La revisión de catálogo debe persistir en PostgreSQL; guardarla solo en memoria pierde la protección cuando se reinicia o publica el servidor.

Las actualizaciones desde hojas son operaciones no destructivas: agregan o actualizan catálogos, pero nunca reemplazan ventas, marcaciones, inventario ni otros registros operativos. Crear un mercado tampoco crea inventario; el stock nace únicamente de abastecimientos explícitos de Canjes o Degustación.

Las eliminaciones individuales de ventas requieren una marca persistente por ID. Un borrado físico sin esa marca permite que la misma fila reaparezca desde Google Sheets o desde el snapshot de un dispositivo desactualizado. La protección también debe cubrir sus movimientos de canje y el saldo derivado.

**Why:** El origen que reenvía la venta no sabe que fue eliminada deliberadamente; la ausencia de una fila no comunica una eliminación en un protocolo basado en upserts. Además, filtrar solo la venta todavía permite reinsertar su movimiento o sobrescribir el stock restaurado.

**How to apply:** En limpiezas destructivas, invalidar la caché de la PWA, limpiar las colecciones locales afectadas y entregar una revisión persistente desde el servidor. Mientras el cliente no confirme esa revisión, ignorar snapshots offline antiguos. En refrescos de hojas, hacer upsert sin eliminar registros ausentes. Para ventas eliminadas individualmente, registrar una tombstone transaccional por ID, rechazar la venta y sus movimientos asociados, y serializar la reconstrucción de inventario con la eliminación. Validar la revisión del catálogo antes de tombstonar evita que una solicitud antigua cruce una limpieza total.