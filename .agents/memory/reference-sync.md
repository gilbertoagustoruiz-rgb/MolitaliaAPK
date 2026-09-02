---
name: Referencias y roles
description: Reglas para sincronizar referencias, preservar relaciones y representar roles.
---

Las referencias se cargan automáticamente en el orden Mercados → Clientes, junto con Promotores y Skus. El código de cliente es su identidad canónica. El permiso interno normaliza variantes, pero la etiqueta exacta del rol de origen se conserva para interfaz, registros y reportes.

**Why:** Los IDs generados en cada importación creaban clientes duplicados y podían romper relaciones. Además, reducir “PROMOTOR PERMANENTE” o “PROMOTOR ROTATIVO” a “PROMOTOR” ocultaba información válida.

**How to apply:** Validar primero los mercados, fusionar clientes por código y migrar cualquier referencia al ID canónico. Usar el rol normalizado solo para autorización y la etiqueta original para presentación.