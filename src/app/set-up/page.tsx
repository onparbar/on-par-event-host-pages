import { loadAdminState } from "@/lib/admin-state";
import { easternDateValue } from "@/lib/event-lifecycle";
import { isValidEntertainmentDate } from "@/lib/entertainment/time";
import { loadStaffEventPlans } from "@/lib/operations/staff-events";
import SetupClient from "./SetupClient";

export const metadata = {
  title: "Event Set Up | On Par Entertainment",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date: requestedDate } = await searchParams;
  const exactDate = Boolean(requestedDate && isValidEntertainmentDate(requestedDate));
  const date = exactDate ? requestedDate! : easternDateValue(new Date());
  const [admin, window] = await Promise.all([
    loadAdminState(),
    loadStaffEventPlans(date, { exactDate }),
  ]);
  const archived = new Set(admin.archivedEventIds);
  return <SetupClient date={date} events={window.plans.filter((event) => !archived.has(event.id))} sourceWarning={window.sourceWarning} />;
}
