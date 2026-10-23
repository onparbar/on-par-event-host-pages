import { todayInEntertainmentTimeZone } from "@/lib/entertainment/time";
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
  return (
    <EntertainmentScheduleDashboard
      initialDate={todayInEntertainmentTimeZone()}
    />
  );
}
