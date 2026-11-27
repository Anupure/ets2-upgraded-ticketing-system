import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/src/auth";
import { getSeatMap } from "@/src/booking-service.js";
import { prisma } from "@/src/prisma";
import { BookingPanel } from "./booking-panel";
import { PassengerJourneyLive } from "./passenger-journey-live";

export const dynamic = "force-dynamic";

export default async function JourneyPage({ params }: { params: Promise<{ journeyId: string }> }) {
  const { journeyId } = await params;
  const [session, journey] = await Promise.all([
    auth(),
    prisma.journey.findUnique({
      where: { id: journeyId },
      select: {
        id: true, journeyNumber: true, name: true, description: true, status: true, ticketPrice: true, currentStopSequence: true,
        stops: { orderBy: { sequence: "asc" }, select: { id: true, sequence: true, name: true, status: true } },
      },
    }),
  ]);
  if (!journey) notFound();
  const [initialSeats, passengerTickets] = await Promise.all([
    getSeatMap(prisma, journey.id, journey.stops[0]?.sequence, journey.stops[1]?.sequence),
    session?.user?.id ? prisma.ticket.findMany({
      where: { journeyId: journey.id, userId: session.user.id },
      orderBy: { purchasedAt: "desc" },
      select: {
        id: true, ticketNumber: true, status: true,
        originStop: { select: { id: true, name: true, sequence: true } },
        destinationStop: { select: { id: true, name: true, sequence: true } },
        seatReservations: { select: { seat: { select: { seatNumber: true } } } },
      },
    }) : Promise.resolve([]),
  ]);
  const stops = journey.stops.map(stop => ({ id: stop.id, sequence: stop.sequence, name: stop.name }));

  return (
    <main className="site-shell">
      <header className="topbar"><Link className="brand" href="/">ROGUE<span>RPM</span></Link><Link href="/">← Back</Link></header>
      <section className="content-section">
        <p className="eyebrow">JOURNEY #{journey.journeyNumber.toString()}</p>
        <h1 className="journey-title">{journey.name}</h1>
        <p className="muted">{journey.description || "Choose your route segment and reserve your place in the convoy."}</p>
        <div className="journey-facts"><span><small>STATUS</small>{journey.status.replaceAll("_", " ")}</span><span><small>FARE</small>{journey.ticketPrice.toString()} tokens</span><span><small>STOPS</small>{journey.stops.length}</span></div>
        <PassengerJourneyLive\n          journeyStatus={journey.status}
          currentStopSequence={journey.currentStopSequence}
          stops={journey.stops.map(stop => ({ id: stop.id, sequence: stop.sequence, name: stop.name, status: stop.status }))}
          tickets={passengerTickets.map(ticket => ({
            id: ticket.id, ticketNumber: ticket.ticketNumber, status: ticket.status,
            originStop: ticket.originStop, destinationStop: ticket.destinationStop,
            seatNumber: ticket.seatReservations[0]?.seat.seatNumber ?? "—",
          }))}
          signedIn={Boolean(session?.user?.id)}
        />
        {journey.status !== "COMPLETED" ? <div className="journey-layout journey-layout-booking">
          <div><h2>Choose your seat</h2><BookingPanel journeyId={journey.id} stops={stops} initialSeats={initialSeats} signedIn={Boolean(session?.user?.id)} canBook={journey.status === "BOOKING_OPEN"} /></div>
        </div> : null}
      </section>
    </main>
  );
}
