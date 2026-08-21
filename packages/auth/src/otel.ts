/**
 * OpenTelemetry integration helpers for Convex Auth.
 *
 * @module
 *
 * The application using Convex Auth owns telemetry setup.
 *
 * Use the helpers in this module when you want Convex Auth spans to participate
 * in your app's existing OpenTelemetry pipeline.
 */

import type { Attributes } from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { LogRecordProcessor } from "@opentelemetry/sdk-logs";
import type { MetricReader } from "@opentelemetry/sdk-metrics";
import type { SpanProcessor, TracerConfig } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

/**
 * Consumer-provided telemetry configuration for Convex Auth spans.
 *
 * The host application decides the service name, exporters, processors, and
 * readers.
 */
export type TelemetryConfig = {
  /** Service name reported to the telemetry backend. */
  serviceName: string;
  /** Optional service version reported alongside the service name. */
  serviceVersion?: string;
  /** Additional OpenTelemetry resource attributes to attach to all spans. */
  attributes?: Attributes;
  /** Span processor or processors used for tracing export. */
  spanProcessor?: SpanProcessor | ReadonlyArray<SpanProcessor>;
  /** Optional tracer configuration forwarded to the underlying SDK. */
  tracerConfig?: Omit<TracerConfig, "resource">;
  /** Metric reader or readers used for metrics export. */
  metricReader?: MetricReader | ReadonlyArray<MetricReader>;
  /** Log record processor or processors used for logs export. */
  logRecordProcessor?: LogRecordProcessor | ReadonlyArray<LogRecordProcessor>;
};

function resolveProcessors(
  input: SpanProcessor | ReadonlyArray<SpanProcessor> | undefined,
): SpanProcessor[] {
  if (input === undefined) return [];
  if (Array.isArray(input)) return [...input] as SpanProcessor[];
  return [input as SpanProcessor];
}

/**
 * Build a Node.js OpenTelemetry tracer provider for an app using Convex Auth.
 *
 * Convex Auth does not install this provider automatically. Provide it from your
 * application runtime when you want server-side spans, metrics, or logs to be
 * exported.
 *
 * @param config - Telemetry configuration supplied by the host application.
 * @returns A registered {@link NodeTracerProvider}.
 *
 * @example
 * ```ts
 * import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
 * import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
 * import { nodeTelemetry } from "@estifanos-sh/convex-auth/otel";
 *
 * const provider = nodeTelemetry({
 *   serviceName: "my-app",
 *   spanProcessor: new BatchSpanProcessor(new OTLPTraceExporter()),
 * });
 * ```
 */
export function nodeTelemetry(config: TelemetryConfig): NodeTracerProvider {
  const attributes: Attributes = {
    [ATTR_SERVICE_NAME]: config.serviceName,
    ...config.attributes,
  };
  if (config.serviceVersion !== undefined) {
    attributes[ATTR_SERVICE_VERSION] = config.serviceVersion;
  }
  const resource = resourceFromAttributes(attributes);
  const provider = new NodeTracerProvider({
    resource,
    spanProcessors: resolveProcessors(config.spanProcessor),
    ...config.tracerConfig,
  });
  provider.register();
  return provider;
}

/**
 * Build a browser OpenTelemetry tracer provider for an app using Convex Auth.
 *
 * Convex Auth does not install this provider automatically. Provide it from your
 * browser runtime when you want client-side Convex Auth spans to be exported.
 *
 * @param config - Telemetry configuration supplied by the host application.
 * @returns A registered {@link WebTracerProvider}.
 *
 * @example
 * ```ts
 * import { browserTelemetry } from "@estifanos-sh/convex-auth/otel";
 *
 * const provider = browserTelemetry({
 *   serviceName: "my-web-app",
 *   attributes: { deployment: "production" },
 * });
 * ```
 */
export function browserTelemetry(config: TelemetryConfig): WebTracerProvider {
  const attributes: Attributes = {
    [ATTR_SERVICE_NAME]: config.serviceName,
    ...config.attributes,
  };
  if (config.serviceVersion !== undefined) {
    attributes[ATTR_SERVICE_VERSION] = config.serviceVersion;
  }
  const resource = resourceFromAttributes(attributes);
  const provider = new WebTracerProvider({
    resource,
    spanProcessors: resolveProcessors(config.spanProcessor),
    ...config.tracerConfig,
  });
  provider.register();
  return provider;
}
