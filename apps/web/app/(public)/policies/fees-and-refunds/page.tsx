import type { Metadata } from "next";

import PolicyPage, { type ManagedPageBody } from "@/components/public/pages/PolicyPage";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerPublicPageBody } from "@/lib/supabase/server-loaders";
import { policies } from "@/modules/content/demo";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Fees & Refunds",
  description:
    "How Faiz E Aam Secondary School bills fees and processes refunds · pending school confirmation.",
  alternates: { canonical: "/policies/fees-and-refunds" },
};

export default async function FeesAndRefundsPolicyPage() {
  let managed: ManagedPageBody | null = null;
  if (dataAdapter() === "supabase") {
    try {
      managed = await loadServerPublicPageBody("policy-fees-refunds");
    } catch {
      managed = null;
    }
  }

  return (
    <div className={styles.page}>
      <PolicyPage policy={policies["fees-and-refunds"]} managed={managed} />
    </div>
  );
}
