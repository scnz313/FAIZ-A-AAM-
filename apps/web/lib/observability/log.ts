import "server-only";

type SafeLogValue = string | number | boolean | null;

/** Structured, correlation-aware logs with an allowlisted safe payload. */
export function providerLog(input: {
  event: string;
  correlationId: string;
  outcome: "started" | "succeeded" | "failed";
  targetType?: string;
  targetReference?: string;
  durationMs?: number;
  values?: Record<string, SafeLogValue>;
}): void {
  const line = {
    timestamp: new Date().toISOString(),
    service: "fass-web",
    event: input.event,
    correlationId: input.correlationId,
    outcome: input.outcome,
    targetType: input.targetType ?? null,
    targetReference: input.targetReference ?? null,
    durationMs: input.durationMs ?? null,
    values: input.values ?? {},
  };
  console.info(JSON.stringify(line));
}

