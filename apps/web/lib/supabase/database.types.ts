/**
 * Placeholder for the Supabase-generated database types.
 *
 * GENERATED FILE CONVENTION: run `npm run db:types` once a database exists
 * (local stack via Docker, or the linked fass-staging project). The generated
 * file replaces this one wholesale — the client factories are typed against
 * `Database` so the swap is mechanical.
 *
 * Do not hand-edit the generated output. Repository rows are mapped into the
 * domain schemas in `packages/contracts`; generated row types are never
 * exported as public UI contracts (plan.md §10).
 */
export type Database = {
  public: {
    Tables: Record<string, unknown>;
    Views: Record<string, unknown>;
    Functions: Record<string, unknown>;
  };
};
