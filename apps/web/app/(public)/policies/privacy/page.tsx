import type { Metadata } from "next";

import PolicyPage from "@/components/public/pages/PolicyPage";
import { policies } from "@/modules/content/demo";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Faiz Aam Secondary School collects, uses, and retains student and family information — concept policy text.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className={styles.page}>
      <PolicyPage policy={policies.privacy} />
    </div>
  );
}
