import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/src/auth";
import { getOperatorDashboard } from "@/src/operator-dashboard-service";
import { prisma } from "@/src/prisma";
import { JourneyControls } from "./journey-controls";
import { OperatorDashboardAutoRefresh } from "./operator-dashboard-auto-refresh";

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
      <header className="topbar"><Link className="brand" href="/">ROGUE<span>RPM</span></Link><nav className="top-actions" aria-label="Operator navigation"><Link href={`/journeys/${journey.id}`}>Passenger view</Link><Link href="/operator/journeys/new">Create journey</Link><Link href="/operator">All journeys</Link></nav></header>
      <section className="content-section operator-section">
        <OperatorDashboardAutoRefresh />
        <p className="eyebrow">CONTROL ROOM · JOURNEY #{journey.journeyNumber}</p>
        <h1>{journey.name}</h1>
        <p className="muted">{journey.status.replaceAll("_", " ")} · Fare {journey.ticketPrice} tokens · {bus.name}</p>
        <div className="operator-stats" aria-label="Live journey statistics">
          <article className="stat-card"><span>Total tickets</span><strong>{passengerCounts.totalTickets}</strong></article>
          <article className="stat-card"><span>Confirmed</span><strong>{passengerCounts.byStatus.CONFIRMED + passengerCounts.byStatus.CHECKED_IN}</strong></article>
          <article className="stat-card"><span>Onboard now</span><strong>{passengerCounts.currentLegOccupiedSeats}</strong></article>
          <article className="stat-card"><span>{passengerCounts.seatAvailabilityScope === "current-leg" ? "Seats free · current leg" : "Seats free · tightest leg"}</span><strong>{passengerCounts.availableSeats} <small>/ {bus.bookableSeats}</small></strong></article>
        </div>
        <p className="operator-live-note">Dashboard refreshes automatically every 5 seconds while this page is open.</p>
        <JourneyControls journeyId={journey.id} status={journey.status} stops={stops.map(stop => ({ id: stop.id, name: stop.name, sequence: stop.sequence, status: stop.status }))} canComplete={passengerCounts.byStatus.CONFIRMED + passengerCounts.byStatus.CHECKED_IN + passengerCounts.byStatus.BOARDED === 0} />
        <h2>Route and stop operations</h2>
        <div className="operator-list">
          {stops.map(stop => <article className="operator-row" key={stop.id}>
            <div><small>STOP {stop.sequence}</small><h3>{stop.name}</h3><p className="muted">{stop.status.replaceAll("_", " ")}</p><Link className="manifest-link" href={`/operator/journeys/${journey.id}/stops/${stop.id}`}>Open passenger manifest →</Link></div>
          </article>)}
        </div>
      </section>
    </main>
  );
}
