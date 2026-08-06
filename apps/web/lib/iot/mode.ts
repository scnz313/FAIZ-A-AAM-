/**
 * Demo-mode flag for the campus-environment (IoT) slice.
 *
 * Until the backend phase ships persistence and real device ingestion, every
 * data surface served by `lib/iot/api.ts` is generated fictional demo data.
 * UI surfaces should surface DEMO_NOTE when DEMO_MODE is true.
 */

export const DEMO_MODE = true;

export const DEMO_NOTE = "Demo data — fictional readings for interface development.";
