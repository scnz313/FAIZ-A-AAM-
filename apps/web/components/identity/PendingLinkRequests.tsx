"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { EmptyState, ErrorPanel, LoadingSkeleton } from "@/components/ui/AsyncStates";
import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useFamilyContext } from "@/components/portal/FamilyContextProvider";
import { formatKolkata } from "@/modules/iot/domain";
import { familyContextService, type PendingLinkRequestView } from "@/modules/services/family-context";

import { PENDING_LINK_REQUESTS_REFRESH_EVENT } from "./pending-link-events";

type LoadState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; items: PendingLinkRequestView[] };

/**
 * The signed-in guardian's own pending child-link requests. A request is a
 * record awaiting school verification, never an active link: submitting one
 * does not activate access, and the public student reference appears only
 * when the school has one on record.
 */
export default function PendingLinkRequests() {
  const { context } = useFamilyContext();
  const accountId = context?.accountId;
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [announcement, setAnnouncement] = useState("");

  const loadRequests = useCallback(async (): Promise<void> => {
    setState({ phase: "loading" });
    setAnnouncement("");
    try {
      const items = await familyContextService.listPendingLinkRequests(accountId);
      setState({ phase: "ready", items });
      setAnnouncement(
        items.length === 0
          ? "No pending link requests."
          : `${items.length} pending link request${items.length === 1 ? "" : "s"}.`,
      );
    } catch {
      setState({ phase: "error" });
    }
  }, [accountId]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  /* A recorded request in the sibling form must appear here immediately. */
  useEffect(() => {
    const refresh = () => void loadRequests();
    window.addEventListener(PENDING_LINK_REQUESTS_REFRESH_EVENT, refresh);
    return () => window.removeEventListener(PENDING_LINK_REQUESTS_REFRESH_EVENT, refresh);
  }, [loadRequests]);

  let body: ReactNode;
  if (state.phase === "loading") {
    body = <LoadingSkeleton lines={3} label="Loading your pending requests" />;
  } else if (state.phase === "error") {
    body = (
      <ErrorPanel
        title="Your pending requests could not be loaded"
        note="Nothing was changed. Check the connection, then try again."
      >
        <Button variant="quiet" type="button" onClick={() => void loadRequests()}>
          Try again
        </Button>
      </ErrorPanel>
    );
  } else if (state.items.length === 0) {
    body = (
      <EmptyState
        title="No pending link requests"
        note="When you ask the school office to link a child, the request appears here while the office verifies it. Nothing is active until the office approves the link."
      />
    );
  } else {
    const showReference = state.items.some((item) => item.studentRef.trim() !== "");
    body = (
      <>
        <div className="table-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th scope="col">Child</th>
                {showReference ? <th scope="col">Student reference</th> : null}
                <th scope="col">Relationship</th>
                <th scope="col">Requested</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((item) => (
                <tr key={item.ref}>
                  <td className="strong">{item.studentName}</td>
                  {showReference ? (
                    <td>
                      {item.studentRef.trim() !== "" ? (
                        <span className="num">{item.studentRef}</span>
                      ) : (
                        <span className="muted">Not available</span>
                      )}
                    </td>
                  ) : null}
                  <td>{item.relationshipLabel}</td>
                  <td className="small muted">
                    <time dateTime={item.requestedAtIso}>
                      {formatKolkata(item.requestedAtIso, { format: "day" })}
                    </time>
                  </td>
                  <td>
                    <StatusBadge tone="watch">Pending verification</StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ margin: "12px 0 0" }}>
          A request waits for the school office to verify it against school records. Submitting a
          request does not activate access.
        </p>
      </>
    );
  }

  return (
    <div>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {body}
    </div>
  );
}
