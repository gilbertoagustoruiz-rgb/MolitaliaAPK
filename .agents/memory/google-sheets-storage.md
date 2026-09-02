---
name: Almacenamiento operativo en Google Sheets
description: Criterio de persistencia automática, fusión y continuidad offline del sistema.
---

Los datos operativos se guardan en un único libro de Google Sheets dentro de la carpeta BBDD, con una pestaña por colección y una fila JSON por registro. Las sesiones del dispositivo y las claves de acceso no se sincronizan.

**Why:** El sistema necesita respaldo central y disponibilidad entre dispositivos sin perder la capacidad de trabajar sin conexión ni exponer credenciales en el libro.

**How to apply:** Mantener localStorage como cola offline de datos, fusionar por identificador en el servidor, serializar las escrituras y reintentar cuando el navegador recupere conexión. Al consolidar clientes, deduplicar por código y remapear sus relaciones al ID canónico.