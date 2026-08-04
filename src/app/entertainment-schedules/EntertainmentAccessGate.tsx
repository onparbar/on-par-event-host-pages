import { PortalAccessGate } from "@/app/_components/PortalShell";

export default function EntertainmentAccessGate() {
  return (
    <PortalAccessGate
      description="Enter the four-digit Event Host PIN to view and edit physical-resource reservations."
      productLabel="Entertainment Resource Operations"
      submitLabel="Open Entertainment Schedule"
      title="Entertainment schedule"
    />
  );
}
