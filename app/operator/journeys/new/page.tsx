import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/src/auth";
import CreateJourneyForm from "../../create-journey-form";

export const dynamic = "force-dynamic";

export default async function NewJourneyPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  if (session.user.role !== "OPERATOR" && session.user.role !== "ADMIN") redirect("/");
  return (
    <main className="site-shell">
      <header className="topbar"><Link className="brand" href="/">ROGUE<span>RPM</span></Link><Link href="/operator">← Operator journeys</Link></header>
      <section className="content-section operator-section">
        <p className="eyebrow">CONTROL ROOM / NEW JOURNEY</p>
        <h1>Create a journey</h1>
        <p className="muted">Set up the route and ticket price. You can review the draft before opening ticket sales.</p>
        <CreateJourneyForm />
      </section>
    </main>
  );
}
