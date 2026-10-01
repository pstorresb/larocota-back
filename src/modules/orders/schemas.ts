import { z } from "zod";

export const selectionsSchema = z.array(z.object({
  groupId: z.string().uuid(),
  options: z.array(z.object({ optionId: z.string().uuid(), quantity: z.number().int().min(1).max(20) })).max(100),
})).max(30).default([]);

export const quoteSchema = z.object({
  cycleId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(20),
    selections: selectionsSchema,
  })).min(1).max(30),
});

export const addressSchema = z.object({
  addressLine: z.string().trim().min(8).max(300),
  sector: z.string().trim().max(120).default(""),
  reference: z.string().trim().max(500).default(""),
  locationText: z.string().trim().max(500).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export const checkoutSchema = z.object({
  cycleId: z.string().uuid(),
  fulfillmentType: z.enum(["pickup", "delivery"]),
  /** Start of the fulfillment slot the customer picked (ISO 8601 with offset), for pickup and delivery alike. */
  slotStartsAt: z.string().datetime({ offset: true, message: "Elige una franja horaria para recibir tu pedido." }),
  contact: z.object({
    email: z.string().email(),
    firstName: z.string().min(2).max(80),
    lastName: z.string().min(2).max(80),
    phone: z.string().trim().regex(/^0\d{9}$/, "El teléfono debe tener 10 dígitos en formato 0XXXXXXXXX."),
  }),
  // Required for delivery, ignored for pickup.
  address: addressSchema.nullish(),
  customerNotes: z.string().max(500).optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(20),
    selections: selectionsSchema,
    customerNote: z.string().max(240).optional(),
  })).min(1).max(30),
}).superRefine((value, context) => {
  if (value.fulfillmentType === "delivery" && !value.address) {
    context.addIssue({ code: "custom", path: ["address"], message: "Indica la dirección de entrega." });
  }
});

export type CheckoutPayload = z.infer<typeof checkoutSchema>;
