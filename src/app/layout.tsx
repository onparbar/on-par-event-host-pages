import type { Metadata } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import { EventContextProvider } from "@/app/_components/EventContext";
import { EventWorkspaceProvider } from "@/app/_components/EventWorkspace";
import { isPreviewReviewOnly } from "@/lib/operations/preview-review";
import { staffLoginRequired } from "@/lib/staff-auth/protocol";
import "./globals.css";
import "./workspace.css";
import "./visual-refresh.css";
import "./kitchen-refresh.css";

export const metadata: Metadata = {
  title: "On Par Event Host",
  description: "Floor plans, entertainment schedules, and itineraries for On Par events.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const staffHeader = staffLoginRequired() ? (await headers()).get("x-event-host-staff-name") : null;
  const staffName = staffHeader ? decodeURIComponent(staffHeader) : "";
  return (
    <html lang="en">
      <body>
        {staffName ? <form method="post" action="/api/staff-auth/logout" className="portal-status-row staff-session-bar">
          <span>Signed in as {staffName}</span>
          <button className="button-link" type="submit" formAction="/api/staff-auth/logout?switch=1">Switch Employee</button>
          <button className="button-link" type="submit">Sign out</button>
        </form> : null}
        {isPreviewReviewOnly() ? <aside role="note" style={{ background: "#18332F", color: "#FFFFFF", padding: "12px 24px" }}>
          Read-only Preview — review the views and quantities. Check-in, orders, sync and saved edits are disabled; Production is unchanged.
        </aside> : null}
        <Suspense fallback={<main className="page"><p>Loading Event Host workspace…</p></main>}>
          <EventContextProvider authenticatedStaffName={staffName}><EventWorkspaceProvider>{children}</EventWorkspaceProvider></EventContextProvider>
        </Suspense>
      </body>
    </html>
  );
}
