export type VipViewSyncCheck = {
  represented: boolean | null;
  detail: string;
  href: string;
};

export type VipSyncHealth = {
  sourceEventId: string;
  sourceFound: boolean | null;
  lastSuccessfulRefreshAt: string | null;
  sourceError: string | null;
  floorPlan: VipViewSyncCheck;
  entertainment: VipViewSyncCheck;
  kitchen: VipViewSyncCheck;
  checkIn: VipViewSyncCheck;
  arrival: "checked-in" | "not-checked-in" | "unverified";
  foodRelease: string | null;
};
