import { sendOrderStatusEmail } from "../common/email/resend.js";
import type { AppEnv } from "../config/env.js";
import type { Database } from "../db/client.js";

export type MaintenanceReport = { cyclesOpened: number; cyclesClosed: number; ordersExpired: number; sessionsPurged: number; codesPurged: number };
/** Structural subset of pino's logger so `app.log` and `console` both work. */
export type MaintenanceLogger = { info: (obj: object, msg?: string) => void; warn: (obj: object, msg?: string) => void; error: (obj: object, msg?: string) => void };

const expiryNote = "Cancelado automáticamente: no recibimos el comprobante de pago dentro del plazo.";

/**
 * Periodic housekeeping. Every step is idempotent and safe to run concurrently with requests:
 * 1. Cycles move scheduled → open → closed by their own dates.
 * 2. Orders still waiting for a proof whose reservation expired are cancelled and their stock released.
 * 3. Expired sessions and one-time codes are purged.
 */
export async function runMaintenance(sql: Database, env: AppEnv, log: MaintenanceLogger): Promise<MaintenanceReport> {
  const opened = await sql`update sales_cycles set status = 'open' where status = 'scheduled' and opens_at <= now() and closes_at > now() returning id`;
  const closed = await sql`update sales_cycles set status = 'closed' where status = 'open' and closes_at <= now() returning id`;

  const expired = await sql<{ id: string }[]>`
    select distinct o.id from orders o
    join stock_reservations sr on sr.order_id = o.id and sr.status = 'reserved' and sr.expires_at is not null and sr.expires_at <= now()
    where o.status in ('payment_pending', 'payment_rejected')
    limit 200
  `;
  const notifications: Array<{ email: string; firstName: string; orderNumber: string; fulfillmentType: string }> = [];
  for (const { id } of expired) {
    const cancelled = await sql.begin(async (tx) => {
      const [order] = await tx<{ id: string; status: string; orderNumber: string; fulfillmentType: string; contactSnapshot: { email: string; firstName: string } }[]>`
        select id, status, order_number, fulfillment_type, contact_snapshot from orders where id = ${id} for update
      `;
      if (!order || !["payment_pending", "payment_rejected"].includes(order.status)) return null;
      const [stillExpired] = await tx`
        select id from stock_reservations where order_id = ${id}
          and status = 'reserved' and expires_at <= now() limit 1
      `;
      if (!stillExpired) return null;
      await tx`update orders set status = 'cancelled', cancelled_at = now() where id = ${order.id}`;
      await tx`update stock_reservations set status = 'released' where order_id = ${order.id} and status in ('reserved', 'committed')`;
      await tx`insert into order_status_history (order_id, from_status, to_status, actor_user_id, public_note) values (${order.id}, ${order.status}, 'cancelled', null, ${expiryNote})`;
      await tx`insert into audit_events (actor_user_id, request_id, entity_type, entity_id, action, before_json, after_json) values (null, 'maintenance', 'order', ${order.id}, 'auto_cancelled', ${tx.json({ status: order.status })}, ${tx.json({ status: "cancelled", reason: "payment_window_expired" })})`;
      return order;
    });
    if (cancelled) notifications.push({ email: cancelled.contactSnapshot.email, firstName: cancelled.contactSnapshot.firstName, orderNumber: cancelled.orderNumber, fulfillmentType: cancelled.fulfillmentType });
  }
  for (const notification of notifications) {
    try { await sendOrderStatusEmail(env, { ...notification, status: "cancelled", note: expiryNote }); }
    catch (error) { log.warn({ err: error, orderNumber: notification.orderNumber }, "could not send expiry email"); }
  }

  const sessions = await sql`delete from sessions where expires_at < now() - interval '7 days' or revoked_at < now() - interval '7 days' returning id`;
  const signupCodes = await sql`delete from email_signup_verifications where expires_at < now() - interval '1 day' returning email`;
  const recoveryCodes = await sql`delete from password_recovery_codes where expires_at < now() - interval '1 day' returning email`;

  const report = { cyclesOpened: opened.length, cyclesClosed: closed.length, ordersExpired: notifications.length, sessionsPurged: sessions.length, codesPurged: signupCodes.length + recoveryCodes.length };
  if (report.cyclesOpened || report.cyclesClosed || report.ordersExpired) log.info(report, "maintenance run");
  return report;
}

/** Runs maintenance on an interval; returns a stop function. A run never overlaps with the previous one. */
export function startMaintenanceJob(sql: Database, env: AppEnv, log: MaintenanceLogger) {
  if (env.MAINTENANCE_INTERVAL_SECONDS === 0) return () => undefined;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runMaintenance(sql, env, log); }
    catch (error) { log.error({ err: error }, "maintenance run failed"); }
    finally { running = false; }
  };
  const timer = setInterval(() => void tick(), env.MAINTENANCE_INTERVAL_SECONDS * 1000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
