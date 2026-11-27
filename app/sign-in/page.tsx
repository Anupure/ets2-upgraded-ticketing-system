import Link from "next/link";
import { signIn } from "@/src/auth";

export default function SignInPage() {
  return (
    <main className="auth-shell">
      <Link className="brand" href="/">ROGUE<span>RPM</span></Link>
      <section className="auth-card">
        <p className="eyebrow">WELCOME ABOARD</p>
        <h1>Join the convoy.</h1>
        <p className="muted">Sign in with Google to create your passenger account. New passengers receive 1,000 welcome tokens.</p>
        <form action={async () => { "use server"; await signIn("google", { redirectTo: "/" }); }}>
          <button className="button button-primary button-full google-button" type="submit"><span aria-hidden="true">G</span> Continue with Google</button>
        </form>
        <p className="auth-footnote">Your account is secured by Google. Your role and wallet are managed by the ticketing system.</p>
      </section>
      <Link className="back-link" href="/">← Back to home</Link>
    </main>
  );
}
