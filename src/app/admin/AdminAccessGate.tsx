import { PortalAccessGate } from "@/app/_components/PortalShell";
import { staffLoginRequired } from "@/lib/staff-auth/protocol";

export default function AdminAccessGate() {
  const passphrase = staffLoginRequired();
  return (
    <PortalAccessGate
      description={passphrase ? "Enter the separate Admin passphrase to manage operations and staffing." : "Enter the four-digit Event Host PIN to manage operations, schedules, assets, and submitted records."}
      passphrase={passphrase}
      productLabel="Event Host Administration"
      submitLabel="Open Admin Dashboard"
      title="Admin access"
    />
  );
}
