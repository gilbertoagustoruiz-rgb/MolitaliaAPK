# Despliegue en DigitalOcean

## Arquitectura

- App Platform ejecuta el frontend y la API desde el Dockerfile.
- Managed PostgreSQL almacena todos los datos operativos.
- Spaces almacena las fotografías comprimidas.
- No se utiliza Google Sheets como almacenamiento, sincronización ni backup.
- El stock operativo se administra únicamente en `warehouses.stock` y su trazabilidad en `warehouse_movements`.
- `inventory`, `inventory_movements` y los antiguos campos de stock en `users.data` se conservan únicamente como histórico/compatibilidad y no son fuente de saldo.

## Variables requeridas

- DATABASE_URL
- SPACES_REGION
- SPACES_BUCKET
- SPACES_ACCESS_KEY_ID
- SPACES_SECRET_ACCESS_KEY
- SPACES_ENDPOINT (opcional; por ejemplo https://nyc3.digitaloceanspaces.com)

Configurar todas las credenciales como variables cifradas. No guardarlas en GitHub.

No configurar variables de Google Sheets para MolitaliaAPK.

## Servicio

- Puerto HTTP: 8080
- Health check: /api/health
- Dockerfile: Dockerfile
- Rama: main

Al iniciar, la API ejecuta un esquema aditivo y no destructivo: crea tablas/índices faltantes y agrega únicamente columnas compatibles que falten. No elimina tablas ni registros.

## Integridad

Antes de agregar nuevas Foreign Keys o ejecutar cambios estructurales, usar:

`scripts/audit-integrity-readonly.sql`

El script abre una transacción `READ ONLY`, reporta huérfanos y anomalías y termina con `ROLLBACK`; no modifica información.
