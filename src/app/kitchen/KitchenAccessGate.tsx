import { PortalAccessGate } from "@/app/_components/PortalShell";

export default function KitchenAccessGate() {
  return (
    <PortalAccessGate
      description="Enter the four-digit Event Host PIN to view live prep requirements and kitchen checklists."
      productLabel="Event Kitchen Operations"
      submitLabel="Open Kitchen Dashboard"
      title="Kitchen access"
    />
  );
}
