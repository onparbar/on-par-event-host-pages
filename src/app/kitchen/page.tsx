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
  return <KitchenDashboard />;
}
