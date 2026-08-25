import type { UUID } from "node:crypto";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";

const CORRELATION_HEADER = "x-correlation-id";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CorrelationIdGenerator = () => UUID | string;

export function registerCorrelationIdHook(
  fastify: FastifyInstance,
  generate: CorrelationIdGenerator = randomUUID,
): void {
  fastify.addHook("onRequest", (request, reply, done) => {
    const correlationId = resolveCorrelationId(request.headers[CORRELATION_HEADER], generate);
    request.headers[CORRELATION_HEADER] = correlationId;
    reply.header(CORRELATION_HEADER, correlationId);
    done();
  });
}

export function resolveCorrelationId(
  value: string | string[] | undefined,
  generate: CorrelationIdGenerator = randomUUID,
): string {
  const candidate = Array.isArray(value) ? undefined : value?.trim();
  if (candidate && UUID_PATTERN.test(candidate)) return candidate.toLowerCase();

  const generated = generate().toLowerCase();
  if (!UUID_PATTERN.test(generated))
    throw new Error("correlation ID generator returned invalid UUID");
  return generated;
}
