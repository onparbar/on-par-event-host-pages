import { PortalAccessGate } from "@/app/_components/PortalShell";

export default function AdminAccessGate() {
  return (
    <PortalAccessGate
      description="Enter the four-digit Event Host PIN to manage operations, schedules, assets, and submitted records."
      productLabel="Event Host Administration"
      submitLabel="Open Admin Dashboard"
      title="Admin access"
    />
  );
}
