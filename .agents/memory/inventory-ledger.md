---
name: Inventario derivado del historial
description: Regla para recuperar saldos cuando una sincronización antigua sobrescribe la fila de inventario.
---

El historial de abastecimientos y consumos es la fuente de verdad para reconstruir el stock de degustación y los componentes de canje cuando existe movimiento registrado.

**Why:** Se observaron abastecimientos de degustación válidos en producción mientras la fila de saldo del mismo mercado estaba en cero, producto de una sincronización posterior con estado antiguo.

**How to apply:** Sumar ajustes de abastecimiento y restar consumos por mercado y componente. Conservar el saldo almacenado solo para categorías sin historial. Las importaciones masivas deben crear movimientos y persistirlos junto al saldo.