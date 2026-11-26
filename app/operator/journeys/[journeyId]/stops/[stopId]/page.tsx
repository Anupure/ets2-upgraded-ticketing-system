import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/src/auth";
import { getPassengerManifest } from "@/src/operator-dashboard-service";
import { prisma } from "@/src/prisma";
import { PassengerManifest } from "./passenger-manifest";

export const dynamic = "force-dynamic";

export default async function OperatorStopManifestPage({
  params,
}: {
  params: Promise<{ journeyId: string; stopId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  if (session.user.role !== "OPERATOR" && session.user.role !== "ADMIN") redirect("/");

  const { journeyId, stopId } = await params;
  let manifest;
  try {
    manifest = await getPassengerManifest(prisma, session.user.id, journeyId, stopId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Stop does not belong")) notFound();
    throw error;
  }

  return (
    <main className="site-shell">
      <header className="topbar">
        <Link className="brand" href="/">ROGUE<span>RPM</span></Link>
        <Link href={`/operator/journeys/${journeyId}`}>← Journey control room</Link>
      </header>
      <section className="content-section operator-section">
        <p className="eyebrow">PASSENGER MANIFEST · STOP {manifest.stop.sequence}</p>
        <h1>{manifest.stop.name}</h1>
        <p className="muted">Stop status: {manifest.stop.status.replaceAll("_", " ")} · {manifest.passengers.length} passenger records</p>
        <PassengerManifest
          journeyId={journeyId}
          stopId={stopId}
          stopStatus={manifest.stop.status}
          passengers={manifest.passengers.map((passenger) => ({
            ticketId: passenger.ticketId,
            ticketNumber: passenger.ticketNumber,
            ticketStatus: passenger.ticketStatus,
            passengerStatus: passenger.passengerStatus,
            displayName: passenger.displayName,
            avatarUrl: passenger.avatarUrl,
            avatarName: passenger.avatarName,
            seatNumber: passenger.seatNumber,
            origin: passenger.origin.name,
            destination: passenger.destination.name,
            stopAction: passenger.stopAction,
          }))}
        />
      </section>
    </main>
  );
}
