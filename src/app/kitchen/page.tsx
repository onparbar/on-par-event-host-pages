import { cookies } from "next/headers";
import { hasAdminSession } from "@/lib/admin-auth";
import KitchenAccessGate from "./KitchenAccessGate";
import KitchenDashboard from "./KitchenDashboard";

export const metadata = {
  title: "Event Kitchen | On Par Entertainment",
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

export default async function KitchenPage() {
  const cookieStore = await cookies();

  if (!hasAdminSession(cookieStore)) {
    return <KitchenAccessGate />;
  }

  return <KitchenDashboard />;
}
