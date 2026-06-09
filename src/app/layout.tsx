import type { Metadata } from "next";
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
      <body>{children}</body>
    </html>
  );
}
