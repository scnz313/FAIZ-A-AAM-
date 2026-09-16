import type { Metadata } from "next";

import GuardiansWorkspace from "./GuardiansWorkspace";

export const metadata: Metadata = {
  title: "Guardians",
};

export default function GuardiansPage() {
  return <GuardiansWorkspace />;
}
