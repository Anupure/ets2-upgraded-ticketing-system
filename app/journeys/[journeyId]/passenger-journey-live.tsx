"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Stop = { id: string; sequence: number; name: string; status: string };
type Ticket = {
  id: string; ticketNumber: string; status: string; seatNumber: string;
  originStop: { id: string; name: string; sequence: number };
  destinationStop: { id: string; name: string; sequence: number };
};

const terminalTicketStatuses = new Set(["COMPLETED", "NO_SHOW", "CANCELLED", "REFUNDED"]);

export function PassengerJourneyLive({ journeyStatus, currentStopSequence, stops, tickets, signedIn }: {
  journeyStatus: string; currentStopSequence: number | null; stops: Stop[]; tickets: Ticket[]; signedIn: boolean;
}) {
  const router = useRouter();
  const [busyTicket, setBusyTicket] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [router]);

  async function checkIn(ticketId: string) {
    setBusyTicket(ticketId);
    setMessage("");
    try {
      const response = await fetch(`/api/tickets/${ticketId}/check-in`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Check-in failed.");
      setMessage("Check-in successful. The operator will confirm physical boarding.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Check-in failed.");
    } finally {
      setBusyTicket(null);
    }
  }

  const departedIndex = stops.findIndex(stop => stop.sequence === currentStopSequence && stop.status === "DEPARTED");
  const journeyComplete = journeyStatus === "COMPLETED";
  const progressStopIndex = journeyComplete ? stops.length - 1 : departedIndex;
  const currentStop = stops.find(stop => stop.sequence === currentStopSequence);
  const boardingStop = stops.find(stop => stop.sequence === currentStopSequence && stop.status === "BOARDING_OPEN");

  return (
    <section className="passenger-live-section" aria-live="polite">
      <div className="passenger-live-heading">
        <div><p className="eyebrow">LIVE JOURNEY</p><h2>{journeyComplete ? "Journey completed" : journeyStatus.replaceAll("_", " ")}</h2></div>
        <span className={journeyComplete ? "live-status-pill completed" : "live-status-pill"}>{journeyComplete ? "COMPLETED" : "AUTO-REFRESH · 5 SEC"}</span>
      </div>
      {journeyComplete ? <p className="journey-complete-banner">You have reached the final destination. Thank you for riding with RogueRPM.</p> : boardingStop ? <p className="journey-live-banner">Boarding is open at <strong>{boardingStop.name}</strong>.</p> : currentStop && (journeyStatus === "PAUSED" || journeyStatus === "BOARDING") ? <p className="journey-live-banner">The coach is currently at <strong>{currentStop.name}</strong>.</p> : null}
      <div className="route-progress" aria-label="Live route progress">
        {stops.map((stop, index) => {
          const departed = stop.status === "DEPARTED" || journeyComplete;
          const arrived = stop.status === "ARRIVED" || stop.status === "BOARDING_OPEN";
          const active = arrived && !journeyComplete;
          const travelling = !journeyComplete && journeyStatus === "IN_PROGRESS" && departedIndex === index;
          const upcoming = !departed && !arrived;
          return (
            <div className={`route-progress-stop ${departed ? "is-departed" : ""} ${active ? "is-current" : ""} ${upcoming ? "is-upcoming" : ""}`} key={stop.id}>
              <div className="route-progress-rail">
                <span className="route-progress-dot">{departed ? "✓" : ""}</span>
                {index < stops.length - 1 ? <span className="route-progress-line"><span className={departed ? "route-progress-fill full" : travelling ? "route-progress-fill half" : "route-progress-fill"} /></span> : null}
                {travelling ? <span className="route-bus-marker" aria-label={`Coach travelling from ${stop.name}`}>BUS</span> : null}
              </div>
              <div className="route-progress-copy">
                <strong>{stop.name}</strong>
                <small>STOP {stop.sequence} · {departed ? "DEPARTED" : active ? stop.status.replaceAll("_", " ") : "UPCOMING"}</small>
                {travelling ? <span className="route-travelling-label">Coach travelling to {stops[index + 1]?.name}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
      {signedIn && tickets.length > 0 ? (
        <div className="passenger-tickets">
          <h3>Your tickets</h3>
          {tickets.map(ticket => {
            const canCheckIn = ticket.status === "CONFIRMED" && journeyStatus === "BOARDING" && currentStopSequence === ticket.originStop.sequence;
            const completed = terminalTicketStatuses.has(ticket.status);
            return (
              <article className="passenger-ticket-card" key={ticket.id}>
                <div><small>TICKET {ticket.ticketNumber}</small><strong>Seat {ticket.seatNumber}</strong><span>{ticket.originStop.name} → {ticket.destinationStop.name}</span><em>{ticket.status.replaceAll("_", " ")}</em></div>
                {canCheckIn ? <button className="button button-primary" type="button" disabled={busyTicket !== null} onClick={() => checkIn(ticket.id)}>{busyTicket === ticket.id ? "Checking in…" : "Check in"}</button> : completed ? <span className="ticket-terminal-note">{ticket.status === "COMPLETED" ? "Journey segment completed" : ticket.status.replaceAll("_", " ")}</span> : ticket.status === "CHECKED_IN" ? <span className="ticket-terminal-note">Checked in · Awaiting operator boarding</span> : ticket.status === "BOARDED" ? <span className="ticket-terminal-note">On board</span> : null}
              </article>
            );
          })}
          {message ? <p className="booking-message" role="status">{message}</p> : null}
        </div>
      ) : signedIn ? null : <p className="muted">Sign in to see your tickets and check-in when boarding opens at your stop.</p>}
      <p className="passenger-live-footnote">Journey status refreshes automatically every 5 seconds. Route progress is based on operator stop updates, not GPS.</p>
    </section>
  );
}
