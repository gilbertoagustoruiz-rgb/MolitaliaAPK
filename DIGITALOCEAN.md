# Despliegue en DigitalOcean

## Arquitectura

- App Platform ejecuta el frontend y la API desde el Dockerfile.
- Managed PostgreSQL almacena todos los datos operativos.
- Spaces almacena las fotografías comprimidas.

## Variables requeridas

- DATABASE_URL
- SPACES_REGION
- SPACES_BUCKET
- SPACES_ACCESS_KEY_ID
- SPACES_SECRET_ACCESS_KEY
- SPACES_ENDPOINT (opcional; por ejemplo https://nyc3.digitaloceanspaces.com)

Configurar todas las credenciales como variables cifradas. No guardarlas en GitHub.

## Servicio

- Puerto HTTP: 8080
- Health check: /api/health
- Dockerfile: Dockerfile
- Rama: main

Al iniciar, la API crea únicamente las tablas que falten mediante CREATE TABLE IF NOT EXISTS.


## Verificación posterior al despliegue

- Confirmar que App Platform despliega la rama `main` con el Dockerfile del repositorio.
- El build productivo ejecuta typecheck de frontend y API antes de compilar.
- Health check: `/api/health` valida proceso y conexión PostgreSQL.
- `/api/healthz` queda disponible como liveness check liviano.
- La API reporta `storage: digitalocean-postgresql`.
- Google Sheets no forma parte del flujo productivo.

- Auditoría relacional (Admin/Analista): `GET /api/app-storage/integrity-audit`.
