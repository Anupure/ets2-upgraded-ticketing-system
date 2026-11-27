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
  const initialSeats = await getSeatMap(prisma, journey.id,
    journey.stops[0]?.sequence, journey.stops[1]?.sequence);
  const stops = journey.stops.map(stop => ({ id: stop.id, sequence: stop.sequence, name: stop.name }));

  return (
    <main className="site-shell">
      <header className="topbar"><Link className="brand" href="/">ROGUE<span>RPM</span></Link><Link href="/">← Back</Link></header>
      <section className="content-section">
        <p className="eyebrow">JOURNEY #{journey.journeyNumber.toString()}</p>
        <h1 className="journey-title">{journey.name}</h1>
        <p className="muted">{journey.description || "Choose your route segment and reserve your place in the convoy."}</p>
        <div className="journey-facts"><span><small>STATUS</small>{journey.status.replaceAll("_", " ")}</span><span><small>FARE</small>{journey.ticketPrice.toString()} tokens</span><span><small>STOPS</small>{journey.stops.length}</span></div>
        <div className="journey-layout">
          <div><h2>Route</h2><div className="route-timeline">{journey.stops.map((stop,index)=><div className="route-stop" key={stop.id}><span className="route-stop-dot" /><div><strong>{stop.name}</strong><small>STOP {stop.sequence} · {stop.status.replaceAll("_"," ")}</small></div>{index<journey.stops.length-1?<span className="route-stop-line"/>:null}</div>)}</div></div>
          <div><h2>Choose your seat</h2><BookingPanel journeyId={journey.id} stops={stops} initialSeats={initialSeats} signedIn={Boolean(session?.user?.id)} canBook={journey.status === "BOOKING_OPEN"} /></div>
        </div>
      </section>
    </main>
  );
}
