import { cookies } from "next/headers";
import { hasAdminSession } from "@/lib/admin-auth";
import { todayInEntertainmentTimeZone } from "@/lib/entertainment/time";
import EntertainmentAccessGate from "./EntertainmentAccessGate";
import EntertainmentScheduleDashboard from "./EntertainmentScheduleDashboard";

export const metadata = {
  title: "Entertainment Schedule | On Par Event Host",
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";

export default async function EntertainmentSchedulesPage() {
  const cookieStore = await cookies();
  if (!hasAdminSession(cookieStore)) {
    return <EntertainmentAccessGate />;
  }
  return (
    <EntertainmentScheduleDashboard
      initialDate={todayInEntertainmentTimeZone()}
    />
  );
}
