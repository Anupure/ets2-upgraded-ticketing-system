import Link from "next/link";
import { auth, signIn, signOut } from "@/src/auth";
import { prisma } from "@/src/prisma";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [session, journey] = await Promise.all([
    auth(),
    prisma.journey.findFirst({
      where: { status: { in: ["BOOKING_OPEN", "BOARDING", "IN_PROGRESS", "PAUSED"] } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, journeyNumber: true, name: true, description: true, status: true,
        ticketPrice: true, currentStopSequence: true,
        stops: { orderBy: { sequence: "asc" }, select: { id: true, sequence: true, name: true, status: true } },
      },
    }),
  ]);

  return (
    <main className="site-shell">
      <header className="topbar">
        <Link className="brand" href="/">ROGUE<span>RPM</span></Link>
        <nav className="top-actions" aria-label="Main navigation">
          {session?.user ? (
            <>
              <span className="user-chip">{session.user.name || "Passenger"}</span>
              {session.user.role === "OPERATOR" || session.user.role === "ADMIN" ? <Link href="/operator">Operator</Link> : null}
              <form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }}>
                <button className="button button-quiet" type="submit">Sign out</button>
              </form>
            </>
          ) : (
            <Link className="button button-primary" href="/sign-in">Sign in</Link>
          )}
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">EURO TRUCK SIMULATOR 2 · LIVE COMMUNITY JOURNEYS</p>
          <h1>Your seat.<br /><span>Your journey.</span></h1>
          <p className="hero-lede">Ride along with the stream. Book a seat, follow every stop and be part of the convoy.</p>
          <div className="hero-actions">
            <a className="button button-primary" href="#active-journey">Explore the journey</a>
            {session?.user ? <span className="signed-in-note">Signed in as {session.user.name || session.user.email}</span> : <Link className="button button-secondary" href="/sign-in">Join the ride</Link>}
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="route-orbit orbit-one" />
          <div className="route-orbit orbit-two" />
          <div className="hero-number">42<span>SEATS</span></div>
          <div className="hero-caption">ONE COMMUNITY<br />ONE CONVOY</div>
        </div>
      </section>

      <section id="active-journey" className="content-section">
        <div className="section-heading">
          <div><p className="eyebrow">LIVE BOARD</p><h2>Active journey</h2></div>
          <span className={journey ? "status-pill status-live" : "status-pill"}>{journey ? journey.status.replaceAll("_", " ") : "NO ACTIVE JOURNEY"}</span>
        </div>
        {journey ? (
          <article className="journey-card">
            <div className="journey-card-main">
              <p className="eyebrow">JOURNEY #{journey.journeyNumber.toString()}</p>
              <h3>{journey.name}</h3>
              <p className="muted">{journey.description || "A community drive on the open road."}</p>
              <div className="stop-list">
                {journey.stops.map((stop, index) => (
                  <div className="stop-item" key={stop.id}>
                    <span className={stop.sequence === journey.currentStopSequence ? "stop-dot stop-current" : "stop-dot"} />
                    <span>{stop.name}</span>
                    <small>{stop.status.replaceAll("_", " ")}</small>
                    {index < journey.stops.length - 1 ? <span className="stop-line" /> : null}
                  </div>
                ))}
              </div>
            </div>
            <aside className="journey-aside">
              <span className="metric-label">TICKET PRICE</span>
              <strong>{journey.ticketPrice.toString()} <small>TOKENS</small></strong>
              <p className="muted">Choose your route segment and seat when booking opens.</p>
              {session?.user ? <Link className="button button-primary button-full" href={`/journeys/${journey.id}`}>View journey</Link> : <Link className="button button-primary button-full" href="/sign-in">Sign in to book</Link>}
            </aside>
          </article>
        ) : (
          <div className="empty-state"><span className="empty-icon">⌁</span><h3>No active journey right now</h3><p>The next convoy will appear here when the operator opens ticketing.</p></div>
        )}
      </section>

      <section className="feature-grid" aria-label="How it works">
        <article className="feature-card"><span className="feature-index">01</span><h3>Pick your seat</h3><p>Choose your boarding and drop-off stops, then reserve an available seat.</p></article>
        <article className="feature-card"><span className="feature-index">02</span><h3>Join the convoy</h3><p>Check in when boarding opens. The operator confirms you are physically onboard.</p></article>
        <article className="feature-card"><span className="feature-index">03</span><h3>Ride together</h3><p>Follow the journey and enjoy the stream with the rest of the community.</p></article>
      </section>
      <footer className="footer"><span>ROGUE<span className="brand-accent">RPM</span></span><span>Built for the road. Driven by the community.</span></footer>
    </main>
  );
}
