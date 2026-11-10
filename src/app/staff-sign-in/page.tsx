import Link from "next/link";

export const metadata = { title: "Staff sign-in | On Par Event Host", robots: { index: false, follow: false } };

export default async function StaffSignIn({ searchParams }: { searchParams: Promise<{ retry?: string }> }) {
  const { retry } = await searchParams;
  return <main className="portal-auth-shell"><section className="portal-auth-card">
    <div className="portal-auth-form-wrap">
      <h1>Sign in through Staff Tools</h1>
      <p>Use your 7shifts Punch ID in Staff Tools. If you’re already signed in there, Event Host won’t ask for it again.</p>
      {retry === "1" ? <p role="alert">This device was signed out, but Event Host couldn’t confirm server-side sign-out. Contact a manager before using a shared device.</p> : null}
      <a className="button-link" href="/api/staff-auth/start">Continue to Staff Tools</a>
      <Link className="portal-back-link" href="/admin">Admin access</Link>
    </div>
  </section></main>;
}
