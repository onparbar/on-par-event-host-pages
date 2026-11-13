import type { Metadata } from "next";
import { Suspense } from "react";
import { EventContextProvider } from "@/app/_components/EventContext";
import { EventWorkspaceProvider } from "@/app/_components/EventWorkspace";
import { isPreviewReviewOnly } from "@/lib/operations/preview-review";
import "./globals.css";
import "./workspace.css";
import "./visual-refresh.css";
import "./kitchen-refresh.css";

export const metadata: Metadata = {
  title: "On Par Event Host",
  description: "Floor plans, entertainment schedules, and itineraries for On Par events.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {isPreviewReviewOnly() ? <aside role="note" style={{ background: "#18332F", color: "#FFFFFF", padding: "12px 24px" }}>
          Read-only Preview — review the views and quantities. Check-in, orders, sync and saved edits are disabled; Production is unchanged.
        </aside> : null}
        <Suspense fallback={<main className="page"><p>Loading Event Host workspace…</p></main>}>
          <EventContextProvider><EventWorkspaceProvider>{children}</EventWorkspaceProvider></EventContextProvider>
        </Suspense>
      </body>
    </html>
  );
}
