---
name: Almacenamiento operativo en Google Sheets
description: Criterio de persistencia automática, fusión y continuidad offline del sistema.
---

Los datos operativos se guardan en un único libro de Google Sheets dentro de la carpeta BBDD, con una pestaña por colección y una fila JSON por registro. Las sesiones del dispositivo y las claves de acceso no se sincronizan.

**Why:** El sistema necesita respaldo central y disponibilidad entre dispositivos sin perder la capacidad de trabajar sin conexión ni exponer credenciales en el libro.

**How to apply:** Mantener localStorage como cola offline de datos, fusionar por identificador en el servidor, serializar las escrituras y reintentar cuando el navegador recupere conexión. Al consolidar clientes, deduplicar por código y remapear sus relaciones al ID canónico.

En producción, la aplicación web y el API deben publicarse juntos después de cambios de sincronización. Una versión web antigua puede mostrar asignaciones localmente mientras el API publicado todavía responde 404 para el almacenamiento central.

**Why:** La asignación puede parecer exitosa en el dispositivo del Analista, pero no llegará a otro dispositivo si la publicación no contiene la ruta central actualizada.

**How to apply:** Después de modificar sincronización, validar `/api/google-sheets-storage` en producción y volver a publicar antes de probar con otro usuario.

Las asignaciones deben leerse y escribirse mediante una operación pequeña e independiente, y vincularse al promotor por DNI además del ID interno.

**Why:** Reescribir todas las pestañas para cada asignación puede agotar temporalmente Google Sheets y dejar un cambio visible solo en el navegador del Analista; el DNI permanece estable aunque cambie el ID importado.

**How to apply:** Para cambios de cobertura, actualizar únicamente ASIGNACIONES, confirmar la respuesta antes de mostrar éxito y refrescar esa colección periódicamente en los dispositivos de Promotor.

Las credenciales no deben depender de la instantánea central: al importar usuarios, deduplicar por DNI y conservar la clave solo desde el almacenamiento local; el login debe esperar a que termine la primera carga de usuarios.

**Why:** Google Sheets intentionally stores no passwords, y las escrituras antiguas pueden dejar registros duplicados del mismo DNI; hidratar la nube sin esta regla deja al usuario sin clave o con un perfil equivocado.

**How to apply:** Usar la fila de usuarios fuente como referencia, fusionar por DNI y no volver a persistir contraseñas en el snapshot central.