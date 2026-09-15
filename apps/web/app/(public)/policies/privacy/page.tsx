import type { Metadata } from "next";

import PolicyPage, { type ManagedPageBody } from "@/components/public/pages/PolicyPage";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerPublicPageBody } from "@/lib/supabase/server-loaders";
import { policies } from "@/modules/content/demo";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Faiz Aam Secondary School collects, uses, and retains student and family information · pending school confirmation.",
  alternates: { canonical: "/policies/privacy" },
};

export default async function PrivacyPolicyPage() {
  let managed: ManagedPageBody | null = null;
  if (dataAdapter() === "supabase") {
    try {
      managed = await loadServerPublicPageBody("policy-privacy");
    } catch {
      managed = null;
    }
  }

  return (
    <div className={styles.page}>
      <PolicyPage policy={policies.privacy} managed={managed} />
    </div>
  );
}
