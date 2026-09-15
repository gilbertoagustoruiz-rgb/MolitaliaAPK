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
