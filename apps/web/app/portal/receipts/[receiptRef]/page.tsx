import type { Metadata } from "next";

import { ReceiptView } from "./ReceiptView";

export const metadata: Metadata = {
  title: "Receipt · Portal",
};

export default async function ReceiptPage({ params }: { params: Promise<{ receiptRef: string }> }) {
  const { receiptRef } = await params;
  return <ReceiptView receiptRef={receiptRef} />;
}
