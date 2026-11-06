import { PortalHeader } from "@/app/_components/PortalShell";

export default function Loading() {
  return (
    <div className="portal-shell">
      <PortalHeader sectionTitle="Event Host" sectionSubtitle="Operations" showEventContext={false} />
      <main className="portal-main page">
        <p className="portal-route-loading" role="status">Loading this section…</p>
      </main>
    </div>
  );
}
