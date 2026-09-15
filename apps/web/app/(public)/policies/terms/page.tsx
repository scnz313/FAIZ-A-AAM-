import type { Metadata } from "next";

import PolicyPage, { type ManagedPageBody } from "@/components/public/pages/PolicyPage";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerPublicPageBody } from "@/lib/supabase/server-loaders";
import { policies } from "@/modules/content/demo";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Terms of Use",
  description:
    "The terms for browsing the public website and using Faiz E Aam Secondary School portals · pending school confirmation.",
  alternates: { canonical: "/policies/terms" },
};

export default async function TermsPolicyPage() {
  let managed: ManagedPageBody | null = null;
  if (dataAdapter() === "supabase") {
    try {
      managed = await loadServerPublicPageBody("policy-terms");
    } catch {
      managed = null;
    }
  }

  return (
    <div className={styles.page}>
      <PolicyPage policy={policies.terms} managed={managed} />
    </div>
  );
}
