"use client";

import Button from "@/components/ui/Button";

/** Client-side print trigger — calls window.print() for the current invoice register. */
export function PrintButton() {
  return <Button variant="quiet" onClick={() => window.print()}>Print</Button>;
}
