import { Suspense } from "react";

import PageIntro from "@/components/public/PageIntro";
import { ErrorPanel } from "@/components/ui/AsyncStates";
import RetryButton from "@/components/ui/RetryButton";
import { contentService, type ContentNotice, type DownloadItem } from "@/modules/services/content";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerPublicContent, loadServerPublicDownloads } from "@/lib/supabase/server-loaders";

import { NoticesPageClient } from "./NoticesPageClient";
import styles from "./page.module.css";

/** Published, public notices and the approved downloads register are read on
 * the server. Supabase uses the anonymous projection (RLS-gated); demo mode
 * keeps the deterministic demo fixtures, and the client still refreshes those
 * from the browser session store. */
export default async function NoticesPage() {
  let initialNotices: ContentNotice[] | null = null;
  let initialDownloads: DownloadItem[] | null = null;
  let loadFailed = false;
  try {
    if (dataAdapter() === "supabase") {
      [initialNotices, initialDownloads] = await Promise.all([
        loadServerPublicContent(),
        loadServerPublicDownloads(),
      ]);
    } else {
      initialNotices = await contentService.listForAudience("public");
      initialDownloads = await contentService.listDownloads();
    }
  } catch {
    loadFailed = true;
  }

  return (
    <div className={styles.page}>
      <PageIntro
        eyebrow="School office"
        title="Notices & downloads"
        deck="Official notices are published here and dated; urgent items carry a mark."
      />
      {loadFailed ? (
        <div className={styles.body}>
          <ErrorPanel
            title="Notices could not be loaded."
            note="The notice list did not load. Nothing was changed. Try again."
          >
            <RetryButton />
          </ErrorPanel>
        </div>
      ) : (
        <Suspense
          fallback={
            <div className={styles.body}>
              <p className={styles.empty}>Loading notices…</p>
            </div>
          }
        >
          <NoticesPageClient initialNotices={initialNotices} initialDownloads={initialDownloads} />
        </Suspense>
      )}
    </div>
  );
}
