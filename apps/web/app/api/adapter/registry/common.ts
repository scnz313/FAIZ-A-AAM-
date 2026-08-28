import { z } from "zod";
import type { ServiceResult } from "@fass/contracts";

import type { AdapterContext, AdapterOperation } from "./types";

export function operation<T extends z.ZodTypeAny>(
  name: string,
  payload: T,
  handle: (context: AdapterContext, payload: z.infer<T>) => Promise<ServiceResult<unknown>>,
): AdapterOperation {
  return {
    name,
    schema: z.object({ op: z.literal(name), payload }),
    async handle(context, value) {
      return handle(context, value as z.infer<T>);
    },
  };
}

export const emptyPayload = z.object({});
export const uuid = z.string().uuid();
export const publicReference = z.string().min(3).max(120);
export const jsonObject = z.record(z.unknown());

/** Parse only the operation belonging to a domain module. */
export function parseOperation(module: { operations: readonly AdapterOperation[] }, value: unknown): AdapterOperation | null {
  for (const candidate of module.operations) {
    const parsed = candidate.schema.safeParse(value);
    if (parsed.success) return candidate;
  }
  return null;
}
