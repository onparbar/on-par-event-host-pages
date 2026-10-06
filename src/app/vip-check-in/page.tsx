import VipCheckInClient from "./VipCheckInClient";

export const metadata = {
  title: "VIP Check-In | On Par Entertainment",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function VipCheckInPage() {
  return <VipCheckInClient />;
}
