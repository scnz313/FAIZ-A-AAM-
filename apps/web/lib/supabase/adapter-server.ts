import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import type { ServiceResult } from "@fass/contracts";

import { getServerActor } from "@/lib/auth/actor";
import { isStaffPath } from "@/lib/auth/portal-routes";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  parseAdapterOperation,
  ReferenceResolutionError,
  resolveAdapterReferences,
  withCorrelation,
} from "@/app/api/adapter/registry";

export async function serverAdapterOperation<T>(
  op: string,
  payload: Record<string, unknown> = {},
): Promise<ServiceResult<T>> {
  const correlationRef = crypto.randomUUID();
  const parsed = parseAdapterOperation({ op, payload });
  if (parsed === null) {
    return { ok: false, errors: [{ code: "validation", message: "Invalid operation payload.", field: null }], correlationRef };
  }
  const pathname = (await headers()).get("x-fass-pathname") ?? "/";
  const actor = await getServerActor();
  if (actor === null) {
    const signInPath = isStaffPath(pathname.split("?", 1)[0] ?? "/") ? "/sign-in/staff" : "/sign-in";
    redirect(`${signInPath}?next=${encodeURIComponent(pathname)}`);
  }
  if (isStaffPath(pathname.split("?", 1)[0] ?? "/") && actor.aal !== "aal2") {
    redirect(`/sign-in/totp?next=${encodeURIComponent(pathname)}`);
  }
  const supabase = await createSupabaseServerClient();
  const cookieStore = await cookies();
  try {
    const normalized = await resolveAdapterReferences(supabase, parsed.operation.name, parsed.payload as Record<string, unknown>);
    const result = await parsed.operation.handle({
      supabase,
      actor,
      selection: {
        familyStudentId: cookieStore.get("fass-active-student")?.value,
        staffRoleGrantId: cookieStore.get("fass-active-workspace")?.value,
      },
    }, normalized);
    return withCorrelation(result, correlationRef) as ServiceResult<T>;
  } catch (error) {
    if (error instanceof ReferenceResolutionError) {
      return { ok: false, errors: [{ code: error.code, message: error.message, field: null }], correlationRef };
    }
    return { ok: false, errors: [{ code: "unavailable", message: "The operation could not be completed.", field: null }], correlationRef, retryable: true };
  }
}
