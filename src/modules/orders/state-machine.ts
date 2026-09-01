export const orderStatuses = [
  "draft", "payment_pending", "payment_review", "payment_rejected", "confirmed",
  "in_preparation", "ready", "out_for_delivery", "delivered", "cancelled",
] as const;

export type OrderStatus = (typeof orderStatuses)[number];

const allowed: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: ["payment_pending", "cancelled"],
  payment_pending: ["payment_review", "cancelled"],
  payment_review: ["payment_rejected", "confirmed", "cancelled"],
  payment_rejected: ["payment_review", "cancelled"],
  confirmed: ["in_preparation", "cancelled"],
  in_preparation: ["ready", "cancelled"],
  ready: ["out_for_delivery", "delivered"],
  out_for_delivery: ["delivered"],
  delivered: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus) {
  return allowed[from].includes(to);
}

export function assertTransition(from: OrderStatus, to: OrderStatus) {
  if (!canTransition(from, to)) throw new Error(`Invalid order transition: ${from} -> ${to}`);
}
