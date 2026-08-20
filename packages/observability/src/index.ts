import { context, propagation, trace } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";

export interface TelemetryOptions {
  serviceName: string;
  enabled?: boolean;
}

export interface TelemetryHandle {
  shutdown(): Promise<void>;
}

export function initializeTelemetry(options: TelemetryOptions): TelemetryHandle {
  if (options.enabled === false) {
    return { shutdown: async () => undefined };
  }

  const sdk = new NodeSDK({ serviceName: options.serviceName });
  sdk.start();

  return {
    shutdown: () => sdk.shutdown(),
  };
}

export function currentTraceContext(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  const span = trace.getActiveSpan();
  const spanContext = span?.spanContext();

  return {
    ...carrier,
    ...(spanContext ? { traceId: spanContext.traceId, spanId: spanContext.spanId } : {}),
  };
}
