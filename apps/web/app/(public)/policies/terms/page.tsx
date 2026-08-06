import type { Metadata } from "next";

import PolicyPage from "@/components/public/pages/PolicyPage";
import { policies } from "@/modules/content/demo";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Terms of Use",
  description:
    "The terms for browsing the public website and using Faiz Aam Secondary School portals — concept policy text.",
};

export default function TermsPolicyPage() {
  return (
    <div className={styles.page}>
      <PolicyPage policy={policies.terms} />
    </div>
  );
}
