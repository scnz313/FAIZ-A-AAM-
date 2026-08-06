import type { ZoneTileData } from "./ZoneTile";
import { ZoneTile } from "./ZoneTile";

import styles from "./ZoneGrid.module.css";

type ZoneGridProps = {
  tiles: ZoneTileData[];
};

/** Responsive grid of zone tiles, already ordered worst-status-first by the caller. */
export function ZoneGrid({ tiles }: ZoneGridProps) {
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
        <a className="link-arrow" href="/staff/facility/zones">
          View all zones →
        </a>
      </div>
      <div className={styles.grid}>
        {tiles.map((tile) => (
          <ZoneTile key={tile.zone.id} data={tile} />
        ))}
      </div>
    </section>
  );
}
