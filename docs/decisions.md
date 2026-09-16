# Decisiones y supuestos

## Vigentes para la primera vertical

- Moneda: USD.
- Dominio canónico: `https://larocota.com`; `www` redirige al dominio principal.
- Zona horaria de presentación: `America/Guayaquil`; persistencia temporal en UTC.
- Modalidad inicial: retiro en Ibarra; cada ciclo define sus fechas y capacidad desde administración.
- IVA: configurable por producto; el backend persiste la tasa y conserva snapshots en cada orden.
- Pago: transferencia bancaria con comprobante JPG, PNG, WebP o PDF de hasta 8 MB. El checkout no publica identificación del titular; mostrará el número completo de cuenta únicamente cuando exista una cuenta real configurada.
- Autenticación: sesión aleatoria guardada como hash; cookie `HttpOnly`, `SameSite=Lax` y `Secure` en producción.
- Precios y cupos: el navegador muestra una vista previa; el backend recalcula y reserva dentro de una transacción.
- Productos eliminables: se desactivan; las órdenes conservan nombres, importes y configuración en snapshots.

## Pendientes antes de producción

- Dirección exacta y horarios definitivos de retiro; zonas y tarifas si se habilita delivery.
- Datos reales de Banco Pichincha y responsables autorizados para editarlos.
- Confirmación contable de precios con IVA y tasas por producto.
- Política de cancelación, reembolso, comprobantes rechazados y caducidad de reservas.
- Proveedor de correo para verificación, recuperación y notificaciones.
- Datos legales para proformas y ventas.
- Límites reales de producción y política de conservación de comprobantes.
- Aprobación final del logotipo y derechos de fotografías y tipografías.

## Estado de los pendientes según el código (auditoría 2026-09-14)

| Pendiente | Estado | Evidencia |
|---|---|---|
| Retiro vs. delivery, zonas y tarifas | Mecanismo listo; tarifas pendientes | Cada ciclo define sus modalidades; el checkout ofrece retiro (por defecto) o entrega y solo pide dirección en entrega. El punto de retiro se configura en `/admin/settings`. No hay tarifas ni zonas de delivery. |
| Datos reales de Banco Pichincha | Listo para cargar | La cuenta se registra en `/admin/settings` (tabla `store_settings`) y se publica al marcar "Publicar". Falta ingresar los datos reales. |
| Confirmación contable de IVA | Parcial | La tasa es editable por producto y se guarda en snapshot; el checkout muestra la etiqueta "IVA (15%)" fija. |
| Política de cancelación, reembolso, comprobantes rechazados, caducidad de reservas | Parcial | Las reservas caducan a las `PAYMENT_WINDOW_HOURS` (24) sin comprobante y el pedido se cancela solo, con aviso por correo; un comprobante rechazado reabre la ventana. Sigue sin haber cancelación por el cliente, reembolsos ni texto de política en la web. |
| Proveedor de correo | Cerrado | Resend implementado en `src/common/email/resend.ts`, con copy para todos los estados visibles al cliente. |
| Datos legales para proformas y ventas | Abierto | Tabla `documents` (`migrations/0006`) sin uso; no hay RUC ni razón social en ningún sitio. |
| Límites de producción y conservación de comprobantes | Abierto | Capacidad por ciclo y producto funciona; no hay purga ni política de retención de archivos en `UPLOAD_DIR`. |
| Logotipo y derechos de fotos y tipografías | Parcial | Licencias OFL de las fuentes versionadas en `larocota-front/src/app/fonts`. Logotipo y fotos siguen sin aprobación formal (`larocota-front/docs/generated-assets.md`). |
