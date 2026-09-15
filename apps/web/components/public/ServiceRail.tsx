import Link from "next/link";

import type { ManagedItem } from "./homeContent";
import styles from "./ServiceRail.module.css";

const ITEMS = [
  {
    icon: "edit_document",
    title: "Apply for admission",
    desc: "One online form, saved as you go, tracked to a decision.",
    href: "/admissions/apply",
  },
  {
    icon: "payments",
    title: "Pay fees",
    desc: "Invoices, receipts and a clear running balance in your portal.",
    href: "/portal/fees",
  },
  {
    icon: "workspace_premium",
    title: "View results",
    desc: "Term results as they are published, version by version.",
    href: "/portal/results",
  },
  {
    icon: "calendar_month",
    title: "See timetable",
    desc: "Class timetables, changes and the examination date sheet.",
    href: "/portal/timetable",
  },
] as const;

export type ServiceRailItem = {
  icon: string;
  title: string;
  desc: string;
  href: string;
};

/**
 * Managed `home-services` rows override titles and descriptions by position.
 * The four journeys, their icons, and their destinations stay structural, so
 * the rail always renders exactly four bordered columns.
 */
export function mergeServiceItems(managed: readonly ManagedItem[] | null): ServiceRailItem[] {
  return ITEMS.map((item, index) => {
    const override = managed?.[index];
    return {
      icon: item.icon,
      title: override !== undefined && override.title.trim() !== "" ? override.title : item.title,
      desc: override !== undefined ? override.line : item.desc,
      href: item.href,
    };
  });
}

/**
 * V15 service rail — four journeys as a bordered 4-column grid on chalk,
 * each with a saffron Material Symbol, serif title, muted description,
 * and an "Open" link. Managed content changes copy only, never the grid.
 */
export default function ServiceRail({ items }: { items?: readonly ManagedItem[] | null } = {}) {
  const rail = mergeServiceItems(items ?? null);

  return (
    <nav className={styles.rail} aria-label="School services">
      {rail.map((item) => (
        <Link
          key={item.href}
          className={styles.item}
          href={item.href}
          prefetch={item.href.startsWith("/portal") ? false : undefined}
        >
          <span className={`${styles.icon} msym`} aria-hidden="true">{item.icon}</span>
          <span className={styles.title}>{item.title}</span>
          <p className={styles.desc}>{item.desc}</p>
          <span className={styles.go}>
            Open <span className="msym" aria-hidden="true">arrow_forward</span>
          </span>
        </Link>
      ))}
    </nav>
  );
}
