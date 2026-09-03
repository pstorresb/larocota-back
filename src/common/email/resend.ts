import type { AppEnv } from "../../config/env.js";

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] ?? char);
}

export async function sendEmail(env: AppEnv, input: { to: string; subject: string; text: string; html: string }) {
  if (!env.RESEND_API_KEY) throw new Error("Email service is not configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [input.to], subject: input.subject, text: input.text, html: input.html }),
  });
  if (!response.ok) throw new Error(`Resend rejected email (${response.status})`);
}

export async function sendPinEmail(env: AppEnv, input: { to: string; code: string; purpose: "signup" | "recovery" }) {
  const recovery = input.purpose === "recovery";
  const title = recovery ? "Restablece tu contraseña" : "Confirma tu cuenta";
  const action = recovery ? "restablecer tu contraseña" : "crear tu cuenta";
  await sendEmail(env, {
    to: input.to, subject: `${input.code} es tu código para La Rocota`,
    text: `Tu código para ${action} en La Rocota es: ${input.code}. Vence en 10 minutos. Si no lo solicitaste, puedes ignorar este correo.`,
    html: `<div style="font-family:Arial,sans-serif;color:#211f1c"><h2>${title}</h2><p>Tu código para ${action} en <strong>La Rocota</strong> es:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:24px 0">${input.code}</p><p>Vence en 10 minutos. Si no lo solicitaste, puedes ignorar este correo.</p></div>`,
  });
}

const orderCopy: Record<string, { title: string; body: string }> = {
  confirmed: { title: "Pago confirmado", body: "Confirmamos tu pago. Ya empezamos a preparar tu pedido." },
  in_preparation: { title: "Estamos preparando tu pedido", body: "Tu pedido ya está en preparación." },
  ready: { title: "Tu pedido está listo", body: "Tu pedido está listo para su siguiente paso." },
  out_for_delivery: { title: "Tu pedido va en camino", body: "Tu pedido salió y va rumbo a tu dirección." },
  delivered: { title: "Pedido entregado", body: "Confirmamos que tu pedido fue entregado. ¡Buen provecho!" },
};

export async function sendOrderStatusEmail(env: AppEnv, input: { email: string; firstName: string; orderNumber: string; status: string; fulfillmentType: string }) {
  const copy = orderCopy[input.status];
  if (!copy) return;
  const name = escapeHtml(input.firstName || "hola");
  const orderNumber = escapeHtml(input.orderNumber);
  const detail = input.status === "ready" && input.fulfillmentType === "pickup" ? "Ya puedes acercarte a retirarlo." : copy.body;
  await sendEmail(env, {
    to: input.email,
    subject: `${copy.title} · ${input.orderNumber}`,
    text: `Hola ${input.firstName || ""}, ${detail} Pedido ${input.orderNumber}.`,
    html: `<div style="font-family:Arial,sans-serif;color:#211f1c"><p>Hola ${name},</p><h2>${copy.title}</h2><p>${escapeHtml(detail)}</p><p><strong>Pedido ${orderNumber}</strong></p></div>`,
  });
}
