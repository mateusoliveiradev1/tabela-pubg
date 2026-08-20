import { z } from "zod";

export const HealthStateSchema = z.enum(["ok", "degraded", "unavailable"]);

export const HealthResponseSchema = z.object({
  service: z.string().min(1),
  state: HealthStateSchema,
  timestamp: z.iso.datetime(),
  checks: z.record(z.string(), HealthStateSchema).optional(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const EventEnvelopeSchema = z.object({
  id: z.uuid(),
  type: z.string().min(1),
  version: z.int().positive(),
  occurredAt: z.iso.datetime(),
  correlationId: z.uuid().optional(),
  causationId: z.uuid().optional(),
  aggregate: z.object({
    type: z.string().min(1),
    id: z.string().min(1),
  }),
  payload: z.record(z.string(), z.unknown()),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

export function createHealthResponse(
  service: string,
  state: HealthResponse["state"],
  checks?: HealthResponse["checks"],
): HealthResponse {
  return HealthResponseSchema.parse({
    service,
    state,
    timestamp: new Date().toISOString(),
    checks,
  });
}
