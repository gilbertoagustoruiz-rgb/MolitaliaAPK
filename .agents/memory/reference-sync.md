---
name: Referencias y roles
description: Reglas para sincronizar referencias, preservar relaciones y representar roles.
---

Las referencias se cargan automáticamente en el orden Mercados → Clientes, junto con Promotores y Skus. El código de cliente es su identidad canónica. En usuarios, el DNI es la identidad canónica: los IDs de fila de la hoja no deben reasignar una persona existente. La hoja de Promotores es autoritativa para vigencia: ausentes se archivan y ocultan, no se borran físicamente, para conservar su historial. El permiso interno normaliza variantes, pero la etiqueta exacta del rol de origen se conserva para interfaz, registros y reportes. La hoja de usuarios puede omitir Mercado o stocks; las columnas ausentes nunca deben borrar asignaciones ni saldos operativos existentes.

**Why:** Los IDs generados en cada importación creaban clientes duplicados y podían romper relaciones. En usuarios, IDs cortos o reordenados llegaron a mezclar el rol y nombre de dos personas; además, interpretar stocks ausentes como cero borró saldos personales. Reducir “PROMOTOR PERMANENTE” o “PROMOTOR ROTATIVO” a “PROMOTOR” también ocultaba información válida.

**How to apply:** Validar primero los mercados, fusionar clientes por código y usuarios por DNI, conservando sus IDs internos. Rechazar la sincronización autoritativa completa si hay filas inválidas o DNI repetidos. Archivar ausentes como inactivos y bloquear su reactivación desde cachés antiguas. En importaciones parciales, actualizar solo columnas presentes y fusionar stocks por componente. Usar el rol normalizado solo para autorización y la etiqueta original para presentación.