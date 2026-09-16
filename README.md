# La Rocota — API

API de pedidos anticipados de comida fresca para Ibarra, Ecuador. Fastify 5, PostgreSQL 17, Zod, sesiones por cookie, pedidos con ciclos de venta y comprobantes de transferencia.

El frontend (Next.js) vive en el repositorio hermano `../larocota-front`. Este repositorio también guarda las copias versionadas de la operación: `docker-compose.yml`, `ecosystem.config.cjs` (PM2), `deploy/` (nginx y plantillas de entorno) y `docs/` (decisiones y roadmap). Para convenciones de código y modelo de dominio, ver `CLAUDE.md`.

## Requisitos

- Node.js 22 o superior
- npm 10 o superior
- Docker con Compose para PostgreSQL

## Inicio local

1. Copia `.env.example` a `.env` y reemplaza las contraseñas de ejemplo.
2. Define `POSTGRES_PASSWORD` en el entorno y ejecuta `docker compose up -d db`.
3. Ejecuta `npm install`, `npm run migrate`, `npm run seed` y `npm run dev`.
4. En `../larocota-front`, copia `.env.example` a `.env.local`, ejecuta `npm install` y `npm run dev`.

La API queda en `http://localhost:4000` con healthcheck en `/health` y readiness en `/ready`; la tienda en `http://localhost:3000`.

## Scripts

```bash
npm run dev          # tsx watch src/server.ts
npm run typecheck    # tsc --noEmit
npm run build        # tsc -> dist/
npm start            # node dist/src/server.js
npm test             # vitest run
npm run migrate      # aplica migrations/*.sql pendientes
npm run seed         # crea o actualiza el superadministrador
npm run seed:demo    # catálogo de demostración (solo desarrollo)
npm run maintenance  # corrida manual del mantenimiento (ciclos, reservas vencidas, purga)
```

La API ejecuta el mismo mantenimiento cada `MAINTENANCE_INTERVAL_SECONDS` (60 por defecto): abre y cierra ciclos por fecha, cancela pedidos sin comprobante cuando vence `PAYMENT_WINDOW_HOURS` (24 por defecto) liberando cupos, y purga sesiones y códigos vencidos.

## Configuración de la tienda

Desde `/admin/settings` un superadministrador registra la cuenta de cobro (se publica en el checkout solo al marcar "Publicar") y el punto de retiro. Mientras la cuenta no esté publicada, el checkout no permite crear pedidos.

## Variables sensibles

Nunca confirmes `.env`, comprobantes ni respaldos. La cuenta bancaria debe configurarse desde administración cuando existan los datos reales (pendiente: ver `docs/roadmap.md`).

## Verificación

```bash
npm run typecheck
npm test
npm run build
```

## Migraciones y seed

`npm run migrate` aplica, en orden, los archivos pendientes de `migrations/` y registra cada nombre en `schema_migrations`. Las migraciones aplicadas no se editan: cualquier cambio posterior debe ser un archivo nuevo.

`npm run seed` es idempotente y crea o actualiza únicamente el superadministrador. Requiere `SEED_SUPERADMIN_EMAIL` y una contraseña de al menos 14 caracteres.

`npm run seed:demo` es un seed opcional para desarrollo: crea tres categorías, tres productos totalmente editables con sus imágenes, grupos de personalización de ejemplo y un ciclo abierto. Los archivos fuente de las imágenes viven en `seed-assets/product-images`; al ejecutar el seed se copian al almacenamiento configurado en `UPLOAD_DIR`. No debe ejecutarse en producción.

## Backups

Ejemplo de respaldo lógico:

```bash
docker compose exec -T db pg_dump -U larocota -Fc larocota > backups/larocota-YYYYMMDD.dump
```

Ejemplo de restauración en una base vacía de ensayo:

```bash
docker compose exec -T db createdb -U larocota larocota_restore_test
docker compose exec -T db pg_restore -U larocota -d larocota_restore_test --clean --if-exists < backups/larocota-YYYYMMDD.dump
```

Además de PostgreSQL, respalda el directorio configurado en `UPLOAD_DIR`. Una restauración solo se considera válida después de probar el arranque de la API y la lectura autorizada de un comprobante.

## Producción

El dominio canónico es `https://larocota.com`; `https://www.larocota.com` redirige al dominio principal. Las plantillas de nginx y variables de producción están en `deploy/`; el archivo de PM2 es `ecosystem.config.cjs` (asume que `../larocota-front` está desplegado junto a este repo).

Antes de desplegar, apunta los registros DNS de `larocota.com` y `www.larocota.com` al servidor, emite un certificado que cubra ambos nombres y reemplaza todos los valores `REEMPLAZAR` de `deploy/env/*.env.example` (incluye Resend, Google y el seed del superadministrador). Completa también las decisiones enumeradas en `docs/decisions.md`, usa secretos fuera del repositorio y un directorio persistente para `UPLOAD_DIR`.

Antes de cobrar en producción: publica la cuenta de cobro desde `/admin/settings`, mantén `TRUST_PROXY=true` detrás de nginx y revisa el resto del plan en `docs/roadmap.md`.
