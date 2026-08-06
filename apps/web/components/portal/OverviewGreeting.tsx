"use client";

import { useFamilyContext } from "./FamilyContextProvider";

/**
 * Client island for the portal overview header: the greeting follows the
 * signed-in guardian and the intro line follows the active linked child, so
 * both update together when a child is switched.
 */
export function OverviewGreeting({ titleClassName }: { titleClassName?: string }) {
  const { guardianName } = useFamilyContext();
  return <h1 className={titleClassName}>Welcome{guardianName ? `, ${guardianName}` : ""}</h1>;
}

export default OverviewGreeting;
