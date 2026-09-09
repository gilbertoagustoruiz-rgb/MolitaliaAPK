---
name: Almacenamiento operativo en PostgreSQL
description: Criterio de persistencia central, acceso SQL y continuidad offline del sistema.
---

Los datos estructurados se guardan en PostgreSQL de Replit, en tablas separadas y consultables para mercados, usuarios, clientes, ventas, marcaciones, inventario, movimientos, asignaciones, cierres y precios. Las fotos permanecen fuera de SQL.

**Why:** Las reescrituras completas de Google Sheets eran lentas y fallaban por disponibilidad de la conexión; las operaciones necesitan persistencia central estable y acceso SQL directo.

**How to apply:** Mantener localStorage como cola offline, fusionar por identificador en el servidor y reintentar al recuperar conexión. Guardar solo URLs de evidencia en SQL; los bytes de fotos siguen en Drive y su cola en IndexedDB.

En producción, la aplicación web y el API deben publicarse juntos después de cambios de sincronización. Una versión web antigua puede mostrar asignaciones localmente mientras el API publicado todavía responde 404 para el almacenamiento central.

**Why:** La asignación puede parecer exitosa en el dispositivo del Analista, pero no llegará a otro dispositivo si la publicación no contiene la ruta central actualizada.

**How to apply:** Después de modificar sincronización o esquema, validar `/api/app-storage` en desarrollo y volver a publicar para que Replit aplique el esquema de producción.

Las asignaciones deben leerse y escribirse mediante una operación pequeña e independiente, y vincularse al promotor por DNI además del ID interno.

**Why:** Una asignación debe quedar disponible de inmediato para otros dispositivos; el DNI permanece estable aunque cambie el ID importado.

**How to apply:** Para cambios de cobertura, actualizar únicamente la tabla de asignaciones, confirmar la respuesta antes de mostrar éxito y refrescar esa colección periódicamente en los dispositivos de Promotor.

Las credenciales de campaña deben deduplicarse por DNI y validarse en el servidor mediante hashes; nunca se devuelve el hash ni la clave al navegador.

**Why:** El acceso entre dispositivos no puede depender de una clave guardada solamente en un navegador, y guardar contraseñas en texto dentro de SQL sería inseguro.

**How to apply:** Aceptar la clave solo en el endpoint de login o al sembrar usuarios, convertirla a hash con sal y devolver únicamente el perfil público.