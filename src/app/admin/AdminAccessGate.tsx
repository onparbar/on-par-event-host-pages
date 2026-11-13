import { PortalAccessGate } from "@/app/_components/PortalShell";
import { requiresStrongAdminSession } from "@/lib/admin-auth";

export default function AdminAccessGate() {
  const passphrase = requiresStrongAdminSession();
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
