"use client";

import { useEffect, useState } from "react";

import { formatKolkata, relativeTime } from "@/modules/iot/domain";

/**
 * Relative time ("2 hours ago") that can never cause a hydration mismatch:
 * until mounted it renders the fixed short timestamp, then swaps to the
 * relative label once client-only. Use anywhere a time appears in
 * server-rendered markup.
 */
export default function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <time className={className} dateTime={iso}>
      {mounted ? relativeTime(iso) : formatKolkata(iso, { format: "short" })}
    </time>
  );
}
