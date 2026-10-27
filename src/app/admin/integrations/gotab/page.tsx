import { cookies } from "next/headers";
import AdminAccessGate from "@/app/admin/AdminAccessGate";
import { PortalPageHeader, PortalShell, PortalStatusBadge } from "@/app/_components/PortalShell";
import { hasAdminSession } from "@/lib/admin-auth";
import { getGoTabConfigurationStatus } from "@/lib/gotab/config";
import GoTabStatusClient from "./GoTabStatusClient";
import GoTabOperationsClient from "./GoTabOperationsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "GoTab Integration | On Par Event Host" };

export default async function GoTabIntegrationPage() {
  if (!hasAdminSession(await cookies())) return <AdminAccessGate />;
  const configuration = getGoTabConfigurationStatus();
  return (
    <PortalShell mainClassName="page" sectionSubtitle="Protected operations" sectionTitle="GoTab Integration">
      <PortalPageHeader
        aside={<PortalStatusBadge tone={configuration.dryRun ? "warning" : "danger"}>{configuration.dryRun ? "Dry run" : "Live configuration"}</PortalStatusBadge>}
        description="Server-only connection status and dispatch safety. Credentials and tokens are never displayed."
        eyebrow="Event Kitchen"
        title="GoTab Integration Status"
      />
      <GoTabStatusClient initialConfiguration={configuration} />
      <GoTabOperationsClient />
    </PortalShell>
  );
}
