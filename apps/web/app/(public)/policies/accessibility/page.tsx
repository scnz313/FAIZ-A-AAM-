import type { Metadata } from "next";

import PolicyPage, { type ManagedPageBody } from "@/components/public/pages/PolicyPage";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerPublicPageBody } from "@/lib/supabase/server-loaders";
import { policies } from "@/modules/content/demo";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Accessibility Statement",
  description:
    "The accessibility target and reporting route for the Faiz E Aam Secondary School website · pending school confirmation.",
  alternates: { canonical: "/policies/accessibility" },
};

export default async function AccessibilityPolicyPage() {
  let managed: ManagedPageBody | null = null;
  if (dataAdapter() === "supabase") {
    try {
      managed = await loadServerPublicPageBody("policy-accessibility");
    } catch {
      managed = null;
    }
  }

  return (
    <div className={styles.page}>
      <PolicyPage policy={policies.accessibility} managed={managed} />
    </div>
  );
}
