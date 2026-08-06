# Campus environment — server layer (planned)

The frontend currently consumes the demo facade at `lib/iot/api.ts` (in-memory
store + deterministic generator). Nothing in this directory is implemented yet;
it will hold the server-side implementation in the backend phase.

Planned contents:

- Route handlers under `app/api/campus/*` exposing the exact same contract as
  `lib/iot/api.ts`: overview, wallboard, zones, zone detail, history, alerts
  (acknowledge/resolve), device registry, and period report generation.
- An ingestion endpoint for device readings: authenticated, idempotent per
  (deviceId, takenAt), append-only.
- Persistence via `packages/db`: readings, zones, devices, alerts, reports —
  timestamps stored as UTC, money-free integer metrics.
- Device adapter contracts: a `SensorSource` interface so future physical
  fleets swap in behind the same domain services without UI changes.
- Authorization per blueprint §5.14: staff facility workspace requires a
  staff role; the public campus page stays unauthenticated and exposes only
  outdoor conditions and general comfort summaries — never private readings.

`modules/iot/domain.ts` (thresholds, CPCB AQI, banding, formatting) and the
shape functions in `modules/iot/demo/generator.ts` are the reference the
backend will reuse.
