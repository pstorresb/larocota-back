# La Rocota — Diagnóstico y roadmap de mejoras

Fecha de auditoría: 2026-09-14. Alcance: `larocota-back` (Fastify 5 + PostgreSQL, 41 rutas) y `larocota-front` (Next.js 16, 25 archivos en `src/`). Las referencias `archivo:línea` apuntan al estado del código en esa fecha.

## Resumen ejecutivo

El MVP tiene una base de dominio sólida (ciclos de venta, cupos con bloqueo por fila, snapshots de pedido, máquina de estados, auditoría completa, dinero en centavos) y una tienda visualmente cuidada. Sin embargo, **hoy no se puede cobrar**: la API nunca sirve la cuenta bancaria y el cliente ve "número de cuenta pendiente de configurar" en el checkout. A eso se suman cuatro fallos de producción invisibles en desarrollo (límites de peticiones compartidos entre todos los usuarios, sin apagado ordenado, catálogo que ignora la fecha de cierre, reservas de cupo que nunca caducan) y una confirmación de pedido con fecha falsa quemada en el código.

En cuanto a profesionalismo, faltan las redes de seguridad básicas: no hay formateador, ni linter en el backend, ni CI, ni tests en el frontend, ni páginas de error/404 propias; y el código está escrito en líneas de hasta 3 000 caracteres, lo que hace muy costoso mantenerlo.

El plan está ordenado en cuatro prioridades: **P0** bloqueantes para vender, **P1** base técnica y robustez, **P2** experiencia de usuario y funcionalidad, **P3** madurez operativa.

### Lo que ya está bien y hay que conservar

- Precios calculados en centavos y validados en el servidor (`POST /orders/quote` antes de crear el pedido).
- Snapshots de contacto, dirección, nombre y modificadores en cada pedido; el catálogo puede cambiar sin alterar pedidos pasados.
- Máquina de estados tabular (`state-machine.ts`) y auditoría del 100 % de mutaciones admin.
- Sesiones opacas con hash, cookie httpOnly, argon2id, PIN con `timingSafeEqual`, guardas de path traversal y detección MIME por contenido.
- Estados vacíos cuidados en tienda, carrito, cuenta y admin; `aria-*` y `focus-visible` en la mayoría de controles; responsive con `dvh`, safe-area y bottom-sheet móvil.

---

## P0 — Bloqueantes para vender

**Estado: implementado el 2026-09-14** (sin commit; revisar con `git status` en cada repo). Verificado con typecheck, 21 tests unitarios, `next build` y una prueba end-to-end contra la base local (pedido → comprobante → rechazo → expiración → cancelación automática).

| # | Qué se hizo |
|---|---|
| P0-1 | Tabla `store_settings` (migración 0013) con `payment` y `pickup`; `GET /settings/public`, `GET /admin/settings`, `PUT /admin/settings/:key` (superadmin, auditado). `/admin/settings` es un formulario real; el checkout muestra la cuenta publicada con botón "copiar" y bloquea el envío mientras no exista. |
| P0-2 | `trustProxy` desde `TRUST_PROXY` (default `true`); `/media/products/*` fuera del límite global; tests de `request.ip` con `X-Forwarded-For`. |
| P0-3 | `GET /orders/:orderNumber` (solo dueño) con ítems, comprobante, historial público y plazo de pago. La confirmación consume datos reales y permite subir o reintentar el comprobante; la cuenta enlaza al detalle y avisa del plazo. |
| P0-4 | `server.ts` maneja SIGTERM/SIGINT con `app.close()` y salida forzada a los 10 s. |
| P0-5 | Plantillas de entorno completas (Resend, Google, seed, `TRUST_PROXY`, `PAYMENT_WINDOW_HOURS`, `MAINTENANCE_INTERVAL_SECONDS`); `.gitignore` ignora `.env.*`; `loadEnv` exige `DATABASE_URL` y `FRONTEND_ORIGIN` en producción. |
| P0-6 | El catálogo filtra por ventana de fechas y devuelve `isOpen` + `fulfillmentModes`; el job abre y cierra ciclos por fecha; la tienda muestra "abre el…" y deshabilita el carrito fuera de ventana. |
| P0-7 | Las reservas escriben `expires_at` (ventana de `PAYMENT_WINDOW_HOURS`); subir comprobante la anula, rechazarlo la renueva; la disponibilidad ignora reservas vencidas; el job de mantenimiento (`src/jobs/maintenance.ts`, cada 60 s y `npm run maintenance`) cancela pedidos vencidos, libera cupos, registra historial y auditoría, y avisa por correo. |
| P0-8 | Correos para `payment_rejected` (con motivo) y `cancelled`; se envían también al rechazar y en la cancelación automática. |
| P0-9 | Las modalidades se eligen por ciclo en el formulario de ciclos; el checkout ofrece retiro o entrega según el ciclo (retiro por defecto), la dirección solo aplica a entrega, y el punto de retiro sale de configuración. Pendiente de negocio: tarifas y zonas de delivery si se habilita. |

Detalle original del diagnóstico:

| # | Problema | Dónde | Propuesta |
|---|---|---|---|
| P0-1 | **La cuenta bancaria no existe para el cliente.** La tabla `bank_accounts` está modelada pero ningún código la lee o escribe. El checkout y `/admin/settings` muestran texto fijo. | `larocota-back/migrations/0005_orders_payments.sql:56`, `larocota-front/src/app/checkout/page.tsx:177`, `larocota-front/src/app/admin/settings/page.tsx:12` | Añadir `GET /api/v1/settings/payment` (público: banco, tipo, número, titular, instrucciones) y `GET/PUT /admin/settings/payment` (superadmin, auditado). Formulario real en `/admin/settings`. Tarjeta bancaria en checkout leída de la API, con botón "copiar número". |
| P0-2 | **Rate limits compartidos por todos los usuarios.** Fastify sin `trustProxy` detrás de nginx: `request.ip` es siempre `127.0.0.1`. El 9.º login fallido de cualquiera bloquea a todos; 120 peticiones/min globales incluyen imágenes. | `larocota-back/src/app.ts:16,21`, `deploy/nginx/larocota.conf` | `Fastify({ trustProxy: true })` (o la IP del proxy). Sacar `/media/products/*` del límite global o darle límite propio. Añadir test que verifique `request.ip` con `X-Forwarded-For`. |
| P0-3 | **Confirmación de pedido con datos falsos.** "Viernes 4 de septiembre · 12:00–14:00" y "El viernes por la mañana" están quemados; la página no consulta el pedido. | `larocota-front/src/app/order-confirmation/[orderNumber]/page.tsx:18-19` | Crear `GET /api/v1/orders/:orderNumber` (solo dueño) con ítems, totales, fecha de entrega, estado del comprobante e historial. La confirmación y la cuenta lo consumen. |
| P0-4 | **Sin apagado ordenado.** `server.ts` no maneja SIGTERM/SIGINT; `app.close()` y `sql.end()` nunca corren en PM2 reload; transacciones pueden morir a medias. | `larocota-back/src/server.ts` | Manejar señales: `await app.close()` con timeout, luego `process.exit`. Documentar `kill_timeout` en PM2. |
| P0-5 | **Plantilla de deploy incompleta.** Faltaban `RESEND_API_KEY`, `GOOGLE_*`, `EMAIL_FROM`, `SEED_*`: un deploy por plantilla deja registro, recuperación y Google en 503. `.gitignore` del back ignora `.env` exacto, no `.env*`. | `deploy/env/larocota-back.env.example`, `larocota-back/.gitignore` | Plantilla corregida en esta auditoría (`larocota-back/deploy/env/`). Pendiente: `.env*` en `.gitignore`; guard en `env.ts` que exija `DATABASE_URL` y `FRONTEND_ORIGIN` explícitos cuando `NODE_ENV=production`. |
| P0-6 | **El catálogo ignora las fechas del ciclo.** Filtra solo por `status`; un ciclo `open` vencido sigue comprable y cada checkout devuelve 409. No hay scheduler que cambie estados. | `larocota-back/src/modules/catalog/routes.ts:10-16`, `admin/routes.ts:428` | Filtrar también por `now() between opens_at and closes_at`; el front muestra "cerrado" con la próxima apertura. Job ligero (ver P1-9) que pase `scheduled→open→closed`. |
| P0-7 | **Reservas de cupo eternas.** `stock_reservations.expires_at` nunca se escribe ni se lee; un checkout abandonado bloquea cupo para siempre. | `larocota-back/src/modules/orders/service.ts:77`, `catalog/routes.ts:23` | Escribir `expires_at` (p. ej. 24 h para `payment_pending`); excluir vencidas del cálculo de disponibilidad; job que cancele pedidos vencidos y notifique. |
| P0-8 | **El cliente no se entera de pago rechazado ni cancelación.** Solo 5 estados tienen correo; la revisión de comprobante solo envía en aprobación. | `larocota-back/src/common/email/resend.ts:28-34`, `admin/routes.ts:289` | Añadir copy para `payment_rejected` (con motivo y enlace para volver a subir) y `cancelled`. Enviar también al rechazar. |
| P0-9 | **Retiro vs. entrega sin decidir en código.** `decisions.md` dice retiro; el front fuerza `delivery` en 3 sitios y el back exige dirección incluso en retiro. | `larocota-front/src/app/checkout/page.tsx:118,159,187`, `features/admin/catalog-crud.tsx:141`, `larocota-back/src/modules/orders/routes.ts:25` | Decidir con el negocio. Implementar selector de modalidad en checkout según `cycle.fulfillmentModes`; `address` opcional cuando es `pickup`; mostrar dirección y horario de retiro (nuevo ajuste en settings). |

---

## P1 — Base técnica, robustez y mantenibilidad

### Herramientas y proceso

| # | Mejora | Detalle |
|---|---|---|
| P1-1 | **Prettier + EditorConfig en ambos repos, ESLint en el back** | Hoy no hay formateador; hay líneas de 2 993 caracteres (`catalog-crud.tsx:140`) y `admin/routes.ts` son 43 KB en 465 líneas. Reformatear en un commit aislado ("format only") para no ensuciar el historial de cambios reales. Añadir `lint-staged` + `husky` (`typecheck`, `lint`, `prettier --check`). |
| P1-2 | **CI en GitHub Actions** | Un workflow por repo: instalar, `typecheck`, `lint`, `test`, `build`. En el back, servicio Postgres para tests de integración. |
| P1-3 | **Tests donde importa** | Back: `orders/service.ts` (cupos, recálculo de precio, snapshots, número de orden), `payments` (propiedad, reemplazo de comprobante, unlink en fallo), flujos de auth (PIN, throttling, `safeNext`), transiciones admin y auditoría. Usar una BD de prueba real (docker) con `truncate` entre tests; `vitest.config.ts` con cobertura y umbrales. Front: vitest + Testing Library para `cart-store`, `extractCoordinates`, validación del checkout y el modal de producto; Playwright para el flujo compra→comprobante. |
| P1-4 | **Dividir `admin/routes.ts`** | 26 rutas + 18 esquemas en un archivo. Separar en `admin/{catalog,cycles,orders,payments,users}.ts` con `requireAdmin` compartido. |
| P1-5 | **Catálogo de códigos de error compartido** | Hoy todo error lanzado colapsa a `REQUEST_ERROR`. Crear `AppError(code, statusCode, message)` y un módulo `errors.ts` con los ~25 códigos; el handler global lo respeta. Exportar la lista para el front (o generar desde OpenAPI, P2-10). Mapear los slugs `google_error` que faltan (`not_configured`, `email_not_verified`) en `login-form.tsx:7-9`. |

### Backend

| # | Mejora | Detalle |
|---|---|---|
| P1-6 | **Paginación y filtros en listados** | `admin/orders`, `admin/users`, `orders/mine` tienen `limit 100` fijo. Añadir `?page&pageSize` (o cursor) con `total`; escapar `%`/`_` en búsquedas ILIKE. El front ya podría enviar `status`/`cycleId` que el back soporta. |
| P1-7 | **Esquemas de respuesta de Fastify** | Varias rutas responden `returning *`; cualquier columna nueva se filtra al cliente. Definir `schema.response` (o usar `fastify-type-provider-zod`) para serializar solo lo público. |
| P1-8 | **Consistencia de validación** | Regla de teléfono distinta entre auth/orders (`^0\d{9}$`) y admin (`min(7).max(24)`); contraseña `min(10)` en registro pero `min(14)` en admin/seed; parámetros argon2 repetidos en 4 sitios; flujo de PIN duplicado (signup y reset). Extraer `common/validation.ts`, `hashUserPassword()` y un helper de PIN con tabla única con columna `purpose`. |
| P1-9 | **Jobs de mantenimiento** | Un `setInterval` en el proceso (o `pg_cron`) para: expirar reservas (P0-7), abrir/cerrar ciclos por fecha (P0-6), purgar `sessions`, `email_signup_verifications` y `password_recovery_codes` vencidos. |
| P1-10 | **Número de pedido secuencial** | `ROC-YYYY-####` aleatorio con 9 000 valores/año y 3 reintentos: colisiones probables a partir de ~300 pedidos y 500 crudo en el 4.º intento. Usar una secuencia por año. |
| P1-11 | **Higiene de seguridad** | Enumeración de usuarios en registro (409 `ACCOUNT_EXISTS`) mientras el reset devuelve siempre 202: unificar. Contador de intentos fallidos por cuenta en login. `PUT /admin/cycles/:id/products` y bajar `global_capacity` deben rechazarse (o validarse) cuando el ciclo está `open` con reservas. `GET /admin/users` expone PII y gasto total a `admin`: evaluar `superadmin`. Cambiar email desde admin sin verificación. Rate limit propio en `PATCH /auth/profile`, `GET /payment-proofs/:id/file` y mutaciones admin. |
| P1-12 | **Logs y observabilidad mínima** | `genReqId` único (UUID) para que `requestId` sirva en soporte; 4xx como `warn`, no `error`; `redact` de cookies y correos; `/ready` proxeado por nginx y comprobando también escritura en `UPLOAD_DIR`. |
| P1-13 | **Guard de producción en `env.ts`** | `DATABASE_URL` y `FRONTEND_ORIGIN` no deben tener default cuando `NODE_ENV=production`; `bodyLimit` para JSON separado del límite de subida (hoy un JSON puede pesar 8 MB). |

### Frontend

| # | Mejora | Detalle |
|---|---|---|
| P1-14 | **Archivos especiales de Next** | `app/not-found.tsx`, `app/error.tsx`, `app/global-error.tsx`, `loading.tsx` por sección con skeletons reales; `robots.ts` con `noindex` para `/admin` y `/account`; `metadata` por página (título, `robots`); `sitemap.ts`; `viewport` con `themeColor`. Comprimir `public/og.png` (2.5 MB). |
| P1-15 | **Manejo de errores y estados** | `storefront.tsx:51-57` sin `.catch()`; `account/page.tsx:35-38` deja "Cargando…" ante errores ≠401; toasts para éxito/error (un `ToastProvider` propio, sin librería). Botón "Reintentar" que rehaga la carga en vez de `location.reload()`. |
| P1-16 | **Primitivas UI y tokens** (con `frontend-design`) | Crear `src/ui/`: `Button` (variantes primary/ghost/danger, tamaños, loading), `Field` (label, hint, error, `aria-invalid`/`aria-describedby`), `Dialog` (focus trap, retorno de foco, Escape, scroll lock, bottom-sheet en móvil), `Drawer`, `Badge` de estado, `Skeleton`, `Toast`, `EmptyState`. Ampliar tokens: radios (`--radius-sm/md/lg`), espaciado, z-index, colores semánticos (`--success`, `--warning`, `--danger`) y sustituir los hex del admin por tokens, eliminando los ~90 overrides de dark mode. Unificar tipografía (quitar Georgia). |
| P1-17 | **Centralizar utilidades** | `lib/format.ts` (moneda, fechas en `es-EC`/`America/Guayaquil`), `lib/order-status.ts` (enum + etiquetas + colores), `lib/validation.ts` (teléfono, email, `safeNext`), `lib/api/types.ts` separado de `client.ts`, `useSession()` con caché para no llamar `api.me()` en cada página. |
| P1-18 | **Tipar el flujo crítico** | `createOrder(input: unknown)` y `uploadProof → { proof: unknown }` deben tener tipos; el cart store con `skipHydration` + flag `hydrated`, `clear()` que resetee `cycleId`, fusión de líneas idénticas y descarte del carrito si cambia el ciclo. Usar `available` para mostrar cupos y bloquear agotados. |
| P1-19 | **Accesibilidad** | Focus trap y retorno de foco en los 5 modales, Escape en todos, scroll lock en drawer y modales admin, `role="tablist"` con flechas en categorías, no mostrar el badge "0" del carrito, restaurar "Cerrar sesión" en cuenta en móvil (`globals.css:647`). |
| P1-20 | **Endurecer protección de rutas** | Añadir `proxy.ts` (middleware de Next 16) que redirija a `/login` cuando no exista la cookie de sesión para `/admin/*` y `/account`; la autorización real sigue en la API. |

---

## P2 — Experiencia de usuario y funcionalidad

| # | Mejora | Detalle |
|---|---|---|
| P2-1 | **Página de producto con URL propia** (`/menu/[slug]`) | Hoy todo es modal: sin enlace compartible ni SEO por plato. Página con metadata, JSON-LD `MenuItem`, galería y el mismo configurador; el modal queda como atajo. |
| P2-2 | **Detalle y seguimiento de pedido del cliente** (`/pedidos/[orderNumber]`) | Línea de tiempo con `order_status_history`, estado del comprobante, botón para volver a subir si fue rechazado, datos de entrega, "pedir de nuevo". Requiere P0-3. |
| P2-3 | **Cancelación por el cliente** | `POST /orders/:id/cancel` mientras esté en `payment_pending`/`payment_review` (según política); libera reservas. |
| P2-4 | **Direcciones guardadas** | Tabla `addresses`, CRUD en cuenta, selector en checkout, ubicación recordada. Elimina volver a escribir la dirección cada semana. |
| P2-5 | **Cuenta completa** | Cambio de contraseña con sesión, cambio de correo con verificación, eliminar cuenta, enlace "Preferencias" que hoy apunta a un ancla inexistente. |
| P2-6 | **Footer y páginas legales** | Horarios, dirección de retiro, WhatsApp del negocio, términos, política de privacidad y de datos (se recoge geolocalización), política de cancelación y reembolso. |
| P2-7 | **Admin de pedidos operativo** | Filtros por estado y ciclo (el back ya los soporta), paginación, ordenación, notas pública/privada (existen en el tipo, no en la UI), impresión de comanda/lista de preparación, exportación CSV, acciones en lote, cancelación con motivo. |
| P2-8 | **Gestión de ciclos** | Vista dedicada por ciclo con capacidad en vivo por producto, "duplicar ciclo anterior", cierre manual con confirmación, calendario. Reemplaza el modal genérico de `CatalogCrud`. |
| P2-9 | **Notificaciones para el admin** | Polling ligero o SSE de comprobantes nuevos; contador en la barra lateral; correo/WhatsApp opcional al negocio. Eliminar el stub `admin/[section]` o convertirlo en la vista de pagos pendientes real. |
| P2-10 | **OpenAPI y cliente generado** | `@fastify/swagger` + `fastify-type-provider-zod`; generar tipos para el front y eliminar la duplicación manual en `client.ts`. |
| P2-11 | **Imágenes** | Redimensionar y convertir a WebP en el servidor (`sharp`) al subir; servir tamaños; quitar `unoptimized` y añadir `placeholder="blur"`. Sustituir el fallback `hero-food.png` por un placeholder de marca que no parezca un plato real. |
| P2-12 | **Tienda** | Indicador de cupos restantes, búsqueda y filtros (vegetariano, precio), mensaje de "ciclo cerrado" con próxima apertura, notas por ítem (el back ya acepta `customerNote`). |
| P2-13 | **Dashboard admin** | Serie temporal de ventas por ciclo, comparativa con el ciclo anterior, top productos, excluir pedidos `payment_pending` de "ventas". |

---

## P3 — Madurez operativa

| # | Mejora |
|---|---|
| P3-1 | Dockerfile multi-stage para API y web, `docker-compose` completo para staging. |
| P3-2 | Sentry (o similar) en ambos, métricas básicas (`/metrics`), alertas de `/ready`. |
| P3-3 | PWA: `manifest.ts`, iconos maskable, instalable en móvil; notificaciones push opcionales. |
| P3-4 | Cupones y descuentos (`orders.discount_total` existe y siempre es 0). |
| P3-5 | Proformas/comprobantes de venta (tabla `documents` sin uso; datos legales pendientes). |
| P3-6 | Integración WhatsApp Business API para notificaciones automáticas (hoy solo enlaces `wa.me` manuales desde admin). |
| P3-7 | Galería de imágenes por producto, reordenación por arrastre de categorías y productos. |
| P3-8 | Política de retención y purga de comprobantes; script de backup programado con verificación de restauración. |
| P3-9 | Eliminar esquema muerto (`product_components`) en una migración nueva. |

---

## Plan de rediseño de interfaz con `frontend-design`

Orden sugerido, cada paso entregable por separado:

1. **Fundamentos**: tokens completos (color semántico, radios, espaciado, z-index, escala tipográfica) y primitivas `Button`, `Field`, `Dialog`, `Drawer`, `Badge`, `Skeleton`, `Toast`, `EmptyState`. Migrar el admin de hex a tokens.
2. **Tienda**: tarjeta de producto con cupos y estado, modal/página de producto, drawer de carrito, estado "ciclo cerrado", footer.
3. **Checkout**: pasos claros (contacto → entrega/retiro → pago), errores por campo con `aria-describedby`, tarjeta bancaria real con "copiar", zona de subida con vista previa del comprobante, resumen fijo en móvil.
4. **Cuenta**: lista de pedidos con estado visual, detalle con línea de tiempo, direcciones, perfil y seguridad.
5. **Admin**: tablas reales (`<table>`) con filtros, paginación y densidad; detalle de pedido con visor de comprobante y acciones; vista de ciclo; settings con formulario; dashboard con gráficos siguiendo el skill `dataviz`.

---

## Esfuerzo e impacto orientativos

| Ítem | Impacto | Esfuerzo |
|---|---|---|
| P0-1 cuenta bancaria end-to-end | Crítico (habilita cobrar) | 1–2 días |
| P0-2 `trustProxy` | Crítico (seguridad) | 1 hora |
| P0-3 detalle de pedido + confirmación real | Alto | 1 día |
| P0-4 apagado ordenado | Alto | 1 hora |
| P0-6 / P0-7 / P1-9 fechas, expiración y jobs | Alto | 1–2 días |
| P0-8 correos faltantes | Medio | 2 horas |
| P0-9 retiro/entrega | Alto (decisión de negocio) | 1–2 días |
| P1-1 / P1-2 formato, lint, hooks, CI | Alto (mantenibilidad) | 1 día |
| P1-3 tests de integración del back | Alto | 2–3 días |
| P1-14 / P1-15 error, 404, loading, toasts | Alto (percepción de calidad) | 1 día |
| P1-16 primitivas y tokens | Alto (base del rediseño) | 2–3 días |
| P1-17 / P1-18 centralizar y tipar | Medio | 1 día |
| P2-1 página de producto | Alto (SEO y compartir) | 1–2 días |
| P2-2 / P2-3 seguimiento y cancelación | Alto | 2 días |
| P2-4 direcciones guardadas | Medio | 1 día |
| P2-7 / P2-8 admin operativo | Alto para el negocio | 3–4 días |
| P2-10 OpenAPI | Medio | 1–2 días |
| P3 | Según prioridad del negocio | — |
