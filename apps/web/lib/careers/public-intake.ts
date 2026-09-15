/**
 * Typed error mapping shared by the public careers intake routes. The
 * service-role SQL commands raise stable `code: message` prefixes; the routes
 * translate them to honest HTTP statuses instead of leaking 500s.
 */
export function statusForCareersIntakeError(message: string): { status: number; code: string } {
  if (message.startsWith("invalid_payload")) return { status: 422, code: "validation" };
  if (message.startsWith("vacancy_not_found")) return { status: 404, code: "not_found" };
  if (message.startsWith("vacancy_not_open") || message.startsWith("deadline_passed")) return { status: 410, code: "closed" };
  if (message.startsWith("vacancy_version_mismatch")) return { status: 409, code: "stale_vacancy" };
  if (message.startsWith("duplicate_application")) return { status: 409, code: "duplicate" };
  if (message.startsWith("photo_not_allowed")) return { status: 422, code: "validation" };
  if (message.startsWith("photo_already_attached")) return { status: 409, code: "duplicate" };
  if (message.startsWith("application_not_found")) return { status: 404, code: "not_found" };
  return { status: 503, code: "unavailable" };
}
