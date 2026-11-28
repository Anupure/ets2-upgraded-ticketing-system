"use client";

import { useEffect, useRef, useState } from "react";

type Stop = { id: string; sequence: number; name: string };
type Seat = { seatNumber: string; row: number; column: number; seatType: string; bookable: boolean; state: string; passenger: { displayName: string; avatarUrl: string | null } | null };

export function BookingPanel({ journeyId, stops, initialSeats, signedIn, canBook, hasActiveTicket, initialTokenBalance, ticketPrice }: {
  journeyId: string; stops: Stop[]; initialSeats: Seat[]; signedIn: boolean; canBook: boolean; hasActiveTicket: boolean;
  initialTokenBalance: string | null; ticketPrice: string;
}) {
  const [originId, setOriginId] = useState(stops[0]?.id ?? "");
  const [destinationId, setDestinationId] = useState(stops[1]?.id ?? "");
  const [seats, setSeats] = useState(initialSeats);
  const [selectedSeat, setSelectedSeat] = useState("");
  const [loadingSeats, setLoadingSeats] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(hasActiveTicket ? "You already have an active ticket for this journey." : "");
  const [bookingConfirmed, setBookingConfirmed] = useState(hasActiveTicket);
  const startingBalance = initialTokenBalance === null ? null : Number(initialTokenBalance);
  const idempotencyKey = useRef<string | null>(null);
  const origin = stops.find(stop => stop.id === originId);
  const destination = stops.find(stop => stop.id === destinationId);

  useEffect(() => {
    if (bookingConfirmed || !origin || !destination || destination.sequence <= origin.sequence) return;
    const controller = new AbortController();
    setLoadingSeats(true);
    fetch(`/api/journeys/${journeyId}/seats?from=${origin.sequence}&to=${destination.sequence}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || "Could not load seats.");
        setSeats(data.seats as Seat[]);
        setSelectedSeat("");
      })
      .catch(error => { if (error.name !== "AbortError") setMessage(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoadingSeats(false); });
    return () => controller.abort();
  }, [journeyId, originId, destinationId, bookingConfirmed]);

  function changeRoute(kind: "origin" | "destination", value: string) {
    idempotencyKey.current = null;
    setMessage("");
    if (kind === "origin") {
      setOriginId(value);
      const nextOrigin = stops.find(stop => stop.id === value);
      const currentDestination = stops.find(stop => stop.id === destinationId);
      if (nextOrigin && currentDestination && currentDestination.sequence <= nextOrigin.sequence) {
        setDestinationId(stops.find(stop => stop.sequence > nextOrigin.sequence)?.id ?? "");
      }
    } else setDestinationId(value);
    setSelectedSeat("");
  }

  async function purchase() {
    if (!canBook || bookingConfirmed) return;
    if (!signedIn) { window.location.href = "/sign-in"; return; }
    if (!origin || !destination || !selectedSeat) return;
    setSubmitting(true);
    setMessage("");
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`/api/journeys/${journeyId}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey.current },
        body: JSON.stringify({ originStopId: originId, destinationStopId: destinationId, seatNumber: selectedSeat }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "Booking failed.");
      setMessage(`Ticket ${data.ticket.ticketNumber} confirmed. Your seat is reserved.`);
      setBookingConfirmed(true);
      if (startingBalance !== null) {
        window.dispatchEvent(new CustomEvent("wallet:balance-updated", { detail: { balance: Math.max(0, startingBalance - Number(ticketPrice)) } }));
      }
      idempotencyKey.current = null;
      const refresh = await fetch(`/api/journeys/${journeyId}/seats?from=${origin.sequence}&to=${destination.sequence}`);
      if (refresh.ok) setSeats((await refresh.json()).seats as Seat[]);
      setSelectedSeat("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Booking failed. Retry using the same selection.");
    } finally {
      setSubmitting(false);
    }
  }

  const destinationOptions = stops.filter(stop => !origin || stop.sequence > origin.sequence);
  return (
    <section className="booking-panel">
      <div className="booking-controls">
        <label>Board at<select disabled={bookingConfirmed} value={originId} onChange={event => changeRoute("origin", event.target.value)}>{stops.map(stop => <option key={stop.id} value={stop.id}>{stop.name}</option>)}</select></label>
        <label>Get off at<select disabled={bookingConfirmed} value={destinationId} onChange={event => changeRoute("destination", event.target.value)}>{destinationOptions.map(stop => <option key={stop.id} value={stop.id}>{stop.name}</option>)}</select></label>
      </div>
      <div className="seat-legend"><span><i className="legend-seat available" /> Available</span><span><i className="legend-seat booked" /> Reserved</span><span><i className="legend-seat occupied" /> Onboard</span></div>
      {loadingSeats ? <p className="muted">Updating seat availability…</p> : (
        <div className="seat-grid">
          {seats.map(seat => <button key={seat.seatNumber} type="button" disabled={bookingConfirmed || !seat.bookable || seat.state !== "AVAILABLE"} aria-pressed={selectedSeat === seat.seatNumber} title={`Seat ${seat.seatNumber}: ${seat.state.toLowerCase()}`} className={`seat-button seat-${seat.state.toLowerCase()} ${selectedSeat === seat.seatNumber ? "seat-selected" : ""}`} onClick={() => { setSelectedSeat(seat.seatNumber); idempotencyKey.current = null; setMessage(""); }}>
            {seat.seatNumber}
          </button>)}
        </div>
      )}
      <div className="booking-submit">
        <p>{selectedSeat ? `Seat ${selectedSeat} selected` : "Select an available seat"}</p>
        <button className="button button-primary" type="button" aria-disabled={!canBook || bookingConfirmed || !selectedSeat || !origin || !destination || submitting || loadingSeats} disabled={!canBook || bookingConfirmed || !selectedSeat || !origin || !destination || submitting || loadingSeats} onClick={purchase}>{bookingConfirmed ? "Booking confirmed" : !canBook ? "Ticketing closed" : submitting ? "Booking…" : signedIn ? "Confirm booking" : "Sign in to book"}</button>
      </div>
      {message ? <p className="booking-message" role="status">{message}</p> : null}
      {!canBook ? <p className="booking-disclaimer">Ticket purchases are available only while the operator has ticketing open.</p> : null}
      <p className="booking-disclaimer">A booking reserves your seat. Physical boarding is confirmed separately by the operator.</p>
    </section>
  );
}
