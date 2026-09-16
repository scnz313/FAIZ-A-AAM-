import type { Metadata } from "next";

import DeliveriesWorkspace from "./DeliveriesWorkspace";

export const metadata: Metadata = {
  title: "Deliveries · Administrator",
};

export default function DeliveriesPage() {
  return <DeliveriesWorkspace />;
}
