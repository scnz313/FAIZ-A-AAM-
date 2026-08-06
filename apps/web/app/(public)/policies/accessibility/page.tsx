import type { Metadata } from "next";

import PolicyPage from "@/components/public/pages/PolicyPage";
import { policies } from "@/modules/content/demo";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Accessibility Statement",
  description:
    "The accessibility target and reporting route for the Faiz Aam Secondary School website — concept policy text.",
};

export default function AccessibilityPolicyPage() {
  return (
    <div className={styles.page}>
      <PolicyPage policy={policies.accessibility} />
    </div>
  );
}
