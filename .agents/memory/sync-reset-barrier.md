---
name: Limpieza sincronizada de catálogos
description: Protección contra la resurrección de registros borrados por snapshots offline antiguos.
---

Cuando una limpieza administrativa elimina catálogos compartidos, no basta con borrar PostgreSQL: una pestaña antigua puede enviar su snapshot local y volver a insertar mercados, clientes o canjes.

**Why:** La PWA conserva estado local y el service worker puede servir una versión anterior durante un tiempo; la sincronización normal no distingue una edición válida de un snapshot obsoleto después de una limpieza definitiva.

La revisión de catálogo debe persistir en PostgreSQL; guardarla solo en memoria pierde la protección cuando se reinicia o publica el servidor.

Las actualizaciones desde hojas son operaciones no destructivas: agregan o actualizan catálogos, pero nunca reemplazan ventas, marcaciones, inventario ni otros registros operativos. Crear un mercado tampoco crea inventario; el stock nace únicamente de abastecimientos explícitos de Canjes o Degustación.

**How to apply:** En limpiezas destructivas, invalidar la caché de la PWA, limpiar las colecciones locales afectadas y entregar una revisión persistente desde el servidor. Mientras el cliente no confirme esa revisión, ignorar snapshots offline antiguos. En refrescos de hojas, hacer upsert sin eliminar registros ausentes.