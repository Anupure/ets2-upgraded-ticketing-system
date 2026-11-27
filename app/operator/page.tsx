import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/src/auth";
import { prisma } from "@/src/prisma";

export const dynamic = "force-dynamic";

export default async function OperatorPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  if (session.user.role !== "OPERATOR" && session.user.role !== "ADMIN") redirect("/");

  const journeys = await prisma.journey.findMany({
    where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, name: true, status: true, journeyNumber: true, stops: { orderBy: { sequence: "asc" }, select: { id: true, name: true, status: true } } },
  });

  return (
    <main className="site-shell">
      <header className="topbar"><Link className="brand" href="/">ROGUE<span>RPM</span></Link><nav className="top-actions" aria-label="Operator navigation"><Link href="/operator/onboarding">Onboarding</Link><Link href="/">Public site</Link></nav></header>
      <section className="content-section operator-section">
        <p className="eyebrow">CONTROL ROOM</p><h1>Operator journeys</h1>
        <div className="operator-create-action"><Link className="button button-primary" href="/operator/journeys/new">+ Create journey</Link></div>\n        <p className="muted">Manage the live journey from a larger screen when possible. The layout remains usable on mobile for on-road operations.</p>
        <div className="operator-list">
          {journeys.map(journey => <article className="operator-row" key={journey.id}><div><small>JOURNEY #{journey.journeyNumber.toString()}</small><h2>{journey.name}</h2><p className="muted">{journey.stops.length} stops · {journey.status.replaceAll("_", " ")}</p></div><Link className="button button-secondary" href={`/operator/journeys/${journey.id}`}>Open control</Link></article>)}
          {journeys.length === 0 ? <div className="empty-state"><h3>No journeys to manage</h3><p>Create a journey using the operator tools once journey creation UI is enabled.</p></div> : null}
        </div>
      </section>
    </main>
  );
}
