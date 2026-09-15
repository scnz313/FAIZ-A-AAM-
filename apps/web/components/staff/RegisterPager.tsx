import Link from "next/link";

import styles from "./RegisterPager.module.css";

/**
 * Discoverable page control for a bounded staff register. The occupied range
 * and the exact total are always visible, so a paged register is never
 * mistaken for the whole set. Links carry only `?page=`, so paging keeps the
 * caller on the same canonical profile route.
 */
export function RegisterPager({
  basePath,
  page,
  pageCount,
  shownFrom,
  shownTo,
  total,
  label,
}: {
  basePath: string;
  page: number;
  pageCount: number;
  shownFrom: number;
  shownTo: number;
  total: number;
  label: string;
}) {
  function hrefFor(target: number): string {
    return target <= 1 ? basePath : `${basePath}?page=${target}`;
  }

  return (
    <nav className={styles.pager} aria-label={`${label} pages`}>
      <p className={`small muted ${styles.summary}`}>
        Showing <span className="num">{shownFrom.toLocaleString("en-IN")}</span>
        {shownTo > 0 ? <>–<span className="num">{shownTo.toLocaleString("en-IN")}</span></> : null} of{" "}
        <span className="num">{total.toLocaleString("en-IN")}</span> {label}
      </p>
      {pageCount > 1 ? (
        <div className={styles.controls}>
          {page > 1 ? (
            <Link prefetch={false} className="btn btn-ghost btn-sm" href={hrefFor(page - 1)}>
              Previous
            </Link>
          ) : (
            <span className={`btn btn-ghost btn-sm ${styles.disabled}`} aria-disabled="true">
              Previous
            </span>
          )}
          <span className={`small muted ${styles.position}`}>
            Page <span className="num">{page}</span> of <span className="num">{pageCount}</span>
          </span>
          {page < pageCount ? (
            <Link prefetch={false} className="btn btn-ghost btn-sm" href={hrefFor(page + 1)}>
              Next
            </Link>
          ) : (
            <span className={`btn btn-ghost btn-sm ${styles.disabled}`} aria-disabled="true">
              Next
            </span>
          )}
        </div>
      ) : null}
    </nav>
  );
}
