import type { Metadata } from "next";

import PolicyPage from "@/components/public/pages/PolicyPage";
import { policies } from "@/modules/content/demo";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Fees & Refunds",
  description:
    "How Faiz Aam Secondary School bills fees and processes refunds — concept policy text.",
};

export default function FeesAndRefundsPolicyPage() {
  return (
    <div className={styles.page}>
      <PolicyPage policy={policies["fees-and-refunds"]} />
    </div>
  );
}
