---
name: Alcance del coordinador
description: Regla de asignación y visibilidad para el rol COORDINADOR.
---

El COORDINADOR reutiliza la estructura de asignaciones de mercados y clientes que ya usa el equipo de campo. Su panel es de consulta y solo expone mercados, clientes, usuarios, ventas e inventario dentro de ese alcance.

**Why:** Mantener una sola fuente de asignaciones evita que la administración de zonas se divida entre estructuras incompatibles y permite que el Analista gestione promotores y coordinadores desde el mismo flujo.

**How to apply:** Cualquier módulo nuevo visible para COORDINADOR debe filtrar por los mercados asignados y, cuando exista, por los clientes asignados; no debe reutilizar el conjunto global de datos sin aplicar ese filtro.