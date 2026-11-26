import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/src/auth";
import { getOperatorDashboard } from "@/src/operator-dashboard-service";
import { prisma } from "@/src/prisma";
import { JourneyControls } from "./journey-controls";

export const dynamic = "force-dynamic";

export default async function OperatorJourneyPage({ params }: { params: Promise<{ journeyId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  if (session.user.role !== "OPERATOR" && session.user.role !== "ADMIN") redirect("/");

  const { journeyId } = await params;
  let dashboard;
  try {
    dashboard = await getOperatorDashboard(prisma, session.user.id, journeyId);
  } catch (error) {
    if (error instanceof Error && error.message === "Journey not found.") notFound();
    throw error;
  }

  const { journey, bus, stops, passengerCounts } = dashboard;
  return (
    <main className="site-shell">
      <header className="topbar"><Link className="brand" href="/">ROGUE<span>RPM</span></Link><Link href="/operator">← Operator journeys</Link></header>
      <section className="content-section operator-section">
        <p className="eyebrow">CONTROL ROOM · JOURNEY #{journey.journeyNumber}</p>
        <h1>{journey.name}</h1>
        <p className="muted">{journey.status.replaceAll("_", " ")} · Fare {journey.ticketPrice} tokens · {bus.name}</p>
        <div className="operator-stats">
          <article className="stat-card"><span>Total tickets</span><strong>{passengerCounts.totalTickets}</strong></article>
          <article className="stat-card"><span>Confirmed</span><strong>{passengerCounts.byStatus.CONFIRMED + passengerCounts.byStatus.CHECKED_IN}</strong></article>
          <article className="stat-card"><span>Onboard now</span><strong>{passengerCounts.currentLegOccupiedSeats}</strong></article>
          <article className="stat-card"><span>Seats available</span><strong>{bus.bookableSeats} / {bus.capacity}</strong></article>
        </div>
        <JourneyControls journeyId={journey.id} status={journey.status} stops={stops.map(stop => ({ id: stop.id, name: stop.name, sequence: stop.sequence, status: stop.status }))} />
        <h2>Route and stop operations</h2>
        <div className="operator-list">
          {stops.map(stop => <article className="operator-row" key={stop.id}>
            <div><small>STOP {stop.sequence + 1}</small><h3>{stop.name}</h3><p className="muted">{stop.status.replaceAll("_", " ")}</p></div>
          </article>)}
        </div>
      </section>
    </main>
  );
}
