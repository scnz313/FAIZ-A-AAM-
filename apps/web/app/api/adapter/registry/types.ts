import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServiceResult } from "@fass/contracts";

import type { Database } from "@/lib/supabase/database.types";
import type { ServerActor } from "@/lib/auth/actor";

export type AdapterSelection = {
  familyStudentId?: string;
  staffRoleGrantId?: string;
};

export type AdapterContext = {
  supabase: SupabaseClient<Database>;
  actor: ServerActor;
  selection: AdapterSelection;
};

/** A registry entry validates its complete `{op,payload}` envelope before the
 * authenticated boundary invokes the handler. Keeping this contract here
 * prevents domain modules from importing Next request/response primitives. */
export type AdapterOperation = {
  name: string;
  schema: { safeParse(value: unknown): { success: true; data: unknown } | { success: false } };
  handle(context: AdapterContext, payload: unknown): Promise<ServiceResult<unknown>>;
};

export type AdapterModule = {
  domain: string;
  operations: readonly AdapterOperation[];
};
