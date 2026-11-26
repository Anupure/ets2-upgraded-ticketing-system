"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Passenger = {
  ticketId: string;
  ticketNumber: string;
  ticketStatus: string;
  passengerStatus: string | null;
  displayName: string;
  avatarUrl: string | null;
  avatarName: string | null;
  seatNumber: string | null;
  origin: string;
  destination: string;
  stopAction: string;
};

type Props = {
  journeyId: string;
  stopId: string;
  stopStatus: string;
  passengers: Passenger[];
};

export function PassengerManifest({ journeyId, stopId, stopStatus, passengers }: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function act(ticketId: string, action: "board" | "disembark" | "no-show") {
    setBusyId(ticketId);
    setError("");
    try {
      const response = await fetch(`/api/operator/tickets/${ticketId}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Passenger action failed.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Passenger action failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="manifest-section">
      <div className="manifest-toolbar">
        <p className="muted">Use operator confirmation only after physically verifying the passenger.</p>
        <button className="button button-secondary" onClick={() => router.refresh()}>Refresh manifest</button>
      </div>
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      {passengers.length === 0 ? (
        <div className="empty-state"><h3>No passengers for this stop</h3><p>There are no tickets whose travel segment includes this stop.</p></div>
      ) : (
        <div className="manifest-list">
          {passengers.map((passenger) => {
            const canBoard = stopStatus === "BOARDING_OPEN" && passenger.stopAction === "BOARD" && passenger.ticketStatus === "CHECKED_IN";
            const canDisembark = (stopStatus === "ARRIVED" || stopStatus === "BOARDING_OPEN") && passenger.stopAction === "ALIGHT" && passenger.ticketStatus === "BOARDED";
            const canNoShow = stopStatus === "DEPARTED" && passenger.stopAction === "BOARD" && ["CONFIRMED", "CHECKED_IN"].includes(passenger.ticketStatus);
            const terminal = ["COMPLETED", "NO_SHOW", "LEFT_BEHIND"].includes(passenger.ticketStatus);
            return (
              <article className="manifest-row" key={passenger.ticketId}>
                <div className="manifest-person">
                  {passenger.avatarUrl ? <img src={passenger.avatarUrl} alt="" className="manifest-avatar" /> : <div className="manifest-avatar manifest-avatar-fallback">{passenger.avatarName?.slice(0, 1) ?? passenger.displayName.slice(0, 1)}</div>}
                  <div className="manifest-person-details">
                    <strong>{passenger.displayName}</strong>
                    <small>{passenger.ticketNumber} · Seat {passenger.seatNumber ?? "—"}</small>
                    <span>{passenger.origin} → {passenger.destination}</span>
                  </div>
                </div>
                <div className="manifest-status">
                  <span>{passenger.ticketStatus.replaceAll("_", " ")}</span>
                  {passenger.passengerStatus ? <small>{passenger.passengerStatus.replaceAll("_", " ")}</small> : null}
                </div>
                <div className="manifest-actions">
                  {canBoard ? <button className="button button-primary" disabled={busyId !== null} onClick={() => act(passenger.ticketId, "board")}>{busyId === passenger.ticketId ? "Working…" : "Confirm boarded"}</button> : null}
                  {canDisembark ? <button className="button button-primary" disabled={busyId !== null} onClick={() => act(passenger.ticketId, "disembark")}>{busyId === passenger.ticketId ? "Working…" : "Confirm disembarked"}</button> : null}
                  {canNoShow ? <button className="button button-secondary" disabled={busyId !== null} onClick={() => act(passenger.ticketId, "no-show")}>{busyId === passenger.ticketId ? "Working…" : "Mark no-show"}</button> : null}
                  {terminal ? <small className="manifest-terminal">Finalized</small> : null}
                  {!canBoard && !canDisembark && !canNoShow && !terminal ? <small className="muted">No action at this stop</small> : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
