import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const exporterUrl = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME || "ai-customer-support",
  traceExporter: exporterUrl ? new OTLPTraceExporter({ url: exporterUrl }) : undefined,
  instrumentations: [getNodeAutoInstrumentations({ "@opentelemetry/instrumentation-fs": { enabled: false } })],
});

sdk.start();
export async function shutdownTracing() { await sdk.shutdown(); }
