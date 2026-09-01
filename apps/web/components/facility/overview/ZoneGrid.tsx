import Link from "next/link";

import type { StaffProfileCode } from "@fass/contracts";
import { canonicalStaffUrl } from "@/lib/auth/portal-routes";
import type { ZoneTileData } from "./ZoneTile";
import { ZoneTile } from "./ZoneTile";

import styles from "./ZoneGrid.module.css";

type ZoneGridProps = {
  tiles: ZoneTileData[];
  profileCode: StaffProfileCode | null;
};

/** Responsive grid of zone tiles, already ordered worst-status-first by the caller. */
export function ZoneGrid({ tiles, profileCode }: ZoneGridProps) {
  if (tiles.length === 0) {
    return (
      <p className={styles.empty}>No zones are reporting yet. Zones appear here once sensors are registered.</p>
    );
  }

  return (
    <section aria-labelledby="zone-grid-heading">
      <div className={styles.head}>
        <h2 id="zone-grid-heading" className={styles.heading}>
          Zones
        </h2>
        <Link prefetch={false} className="link-arrow" href={canonicalStaffUrl(profileCode, "/facility/zones")}>
          View all zones →
        </Link>
      </div>
      <div className={styles.grid}>
        {tiles.map((tile) => (
          <ZoneTile key={tile.zone.id} data={tile} profileCode={profileCode} />
        ))}
      </div>
    </section>
  );
}
