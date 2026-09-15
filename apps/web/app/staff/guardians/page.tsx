import type { Metadata } from "next";

import GuardiansWorkspace from "./GuardiansWorkspace";

export const metadata: Metadata = {
  title: "Guardians · Administrator",
};

export default function GuardiansPage() {
  return <GuardiansWorkspace />;
}
