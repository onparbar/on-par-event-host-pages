import type { Metadata } from "next";
import { Suspense } from "react";
import { EventContextProvider } from "@/app/_components/EventContext";
import "./globals.css";

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
        <Suspense fallback={<main className="page"><p>Loading Event Host workspace…</p></main>}>
          <EventContextProvider>{children}</EventContextProvider>
        </Suspense>
      </body>
    </html>
  );
}
