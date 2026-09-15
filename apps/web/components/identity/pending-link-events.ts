/**
 * Fired after the guardian records a link request so the sibling
 * pending-requests panel re-reads instead of leaving a stale empty list
 * next to the success confirmation.
 */
export const PENDING_LINK_REQUESTS_REFRESH_EVENT = "fass:pending-link-requests-refresh";
