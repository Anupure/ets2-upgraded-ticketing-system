import Link from "next/link";
import { auth } from "@/src/auth";

export const dynamic = "force-dynamic";

export default async function OperatorOnboardingPage() {
  const session = await auth();
  const role = session?.user?.role;
  const isOperator = role === "OPERATOR" || role === "ADMIN";

  return (
    <main className="site-shell">
      <header className="topbar">
        <Link className="brand" href="/">ROGUE<span>RPM</span></Link>
        <Link href="/">← Home</Link>
      </header>
      <section className="content-section operator-section">
        <p className="eyebrow">DRIVER / CONDUCTOR ACCESS</p>
        <h1>Operator onboarding</h1>
        <p className="muted">Operator access is assigned deliberately. Signing in or reading this page does not grant permission to manage journeys.</p>

        <div className="journey-card">
          <div className="journey-card-main">
            <h2>How operator access works</h2>
            <div className="stop-list">
              <div className="stop-item"><span className="stop-dot stop-current" /><span>Sign in with your registered account.</span></div>
              <div className="stop-item"><span className="stop-dot" /><span>Platform administration reviews and assigns operator access.</span></div>
              <div className="stop-item"><span className="stop-dot" /><span>Once authorized, use the operator dashboard to manage journeys.</span></div>
            </div>
            <p className="muted">For now, operator authorization is managed manually by the platform administrator. An online application and approval workflow has not been implemented yet.</p>
          </div>
          <aside className="journey-aside">
            <span className="metric-label">YOUR ACCESS</span>
            <strong>{!session?.user ? "SIGN IN REQUIRED" : isOperator ? "AUTHORIZED" : "PASSENGER"}</strong>
            <p className="muted">{!session?.user ? "Sign in first so the administrator can identify your account." : isOperator ? "Your account currently has operator permissions." : "Your account does not currently have operator permissions."}</p>
            {!session?.user ? <Link className="button button-primary button-full" href="/sign-in">Sign in</Link> : isOperator ? <Link className="button button-primary button-full" href="/operator">Open operator dashboard</Link> : <Link className="button button-secondary button-full" href="/">Back to home</Link>}
          </aside>
        </div>
      </section>
    </main>
  );
}
