import type { Metadata } from "next";
import type { OverviewSummary, Zone, ZoneCurrent } from "@fass/contracts";
import { getOverview, getZones } from "@/lib/iot/api";
import EnvironmentHero from "@/components/public/EnvironmentHero";
import EnvironmentConditions from "@/components/public/EnvironmentConditions";
import EnvironmentZones from "@/components/public/EnvironmentZones";
import EnvironmentExplainers from "@/components/public/EnvironmentExplainers";
import EnvironmentAdvisory from "@/components/public/EnvironmentAdvisory";
import { LakeScene } from "@/components/ui/art";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Campus Environment",
  description:
    "Outdoor air, indoor comfort, and light readings from across the campus — the public face of the school’s environment monitoring.",
};

export default async function EnvironmentPage() {
  let overview: OverviewSummary | null = null;
  let zones: { zones: Zone[]; current: Record<string, ZoneCurrent> } | null =
    null;
  try {
    const [summary, zoneData] = await Promise.all([getOverview(), getZones()]);
    overview = summary;
    zones = zoneData;
  } catch {
    // The facade may be unavailable in early builds; the sections below
    // render an honest "unavailable" fallback instead of failing the page.
  }

  return (
    <div className={styles.page}>
      <EnvironmentHero />
      <div className="ornament-rule ornament-rule--tight" aria-hidden="true">
        <i className="ornament-rule__diamond" />
      </div>
      <EnvironmentConditions outdoor={overview?.outdoor ?? null} />
      <div className="ornament-rule ornament-rule--tight" aria-hidden="true">
        <i className="ornament-rule__diamond" />
      </div>
      <EnvironmentZones data={zones} />
      <figure className={styles.lakeBand}>
        <LakeScene ariaHidden className={styles.lakeArt} />
        <figcaption className={styles.lakeCaption}>
          Wular lake from the school road — concept art
        </figcaption>
      </figure>
      <div className="ornament-rule ornament-rule--tight" aria-hidden="true">
        <i className="ornament-rule__diamond" />
      </div>
      <EnvironmentExplainers />
      <div className="ornament-rule ornament-rule--tight" aria-hidden="true">
        <i className="ornament-rule__diamond" />
      </div>
      <EnvironmentAdvisory />
    </div>
  );
}
