---
name: Stock operativo por promotor
description: Propiedad de los saldos de canje y degustación durante la operación.
---

Cada promotor tiene saldos independientes de Avena, Spaghetti, Batea, Mandil y Degustación. La hoja de Promotores y la creación de accesos no asignan stock. Los artículos de canje se abastecen desde Canjes; las ventas y cierres descuentan del usuario activo. El mercado identifica dónde ocurrió el movimiento, pero no es dueño del saldo operativo.

**Why:** Los materiales se entregan a personas concretas y un saldo compartido por mercado mezcla entregas y consumos de distintos promotores.

**How to apply:** Crear e importar promotores con saldo inicial cero, sin leer columnas de stock. Registrar abastecimientos personales como movimientos desde Canjes y revertir el saldo al eliminarlos. No crear, importar, reconstruir ni mostrar inventario histórico por mercado; el mercado solo aporta ubicación al historial operativo.