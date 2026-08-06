import type { Metadata } from "next";
import { ReportsWorkspace } from "@/components/facility/reports/ReportsWorkspace";

export const metadata: Metadata = {
  title: "Reports · Facility",
};

export default function ReportsPage() {
  return (
    <div>
      <header className="workspace-header">
        <p className="eyebrow">Facility · Reports</p>
        <h1 className="workspace-title">Reports</h1>
        <p className="workspace-intro">
          Generate a period report with per-zone statistics for the metrics you choose. Reports cover all zones.
        </p>
      </header>
      <ReportsWorkspace />
    </div>
  );
}
