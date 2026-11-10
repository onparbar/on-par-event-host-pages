import Link from "next/link";

export const metadata = { title: "Staff sign-in | On Par Event Host", robots: { index: false, follow: false } };

export default async function StaffSignIn({ searchParams }: { searchParams: Promise<{ retry?: string }> }) {
  const { retry } = await searchParams;
  return <main className="portal-auth-shell"><section className="portal-auth-card">
    <div className="portal-auth-form-wrap">
      <h1>Sign in to Event Host</h1>
      <p>Choose your name and enter your 4-digit 7shifts Punch ID to open Event Host. If you launch Event Host from your signed-in Staff Tools dashboard, you won’t need to enter it again.</p>
      {retry === "1" ? <p role="alert">This device was signed out, but Event Host couldn’t confirm server-side sign-out. Contact a manager before using a shared device.</p> : null}
      <a className="button-link" href="/api/staff-auth/start">Continue to Punch ID sign-in</a>
      <Link className="portal-back-link" href="/admin">Admin access</Link>
    </div>
  </section></main>;
}
