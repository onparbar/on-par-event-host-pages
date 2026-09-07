import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin-auth";
import { GoTabIntegrationStorage } from "@/lib/gotab/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAN_SIZES = new Set([
  "THIRD_PAN", "HALF_PAN", "FULL_PAN", "TRAY", "EACH", "DOZEN", "BOWL", "REFILL", "NOT_APPLICABLE",
]);
const STATIONS = new Set(["EXPO", "FRYER", "GRILL", "COLD_PREP"]);
const MAPPING_STATUSES = new Set(["NEEDS_MAPPING", "MAPPED", "VERIFIED", "DISABLED"]);

async function authorized() {
  return hasAdminSession(await cookies());
}

export async function GET() {
  if (!(await authorized())) {
    return NextResponse.json({ error: "Admin session required." }, { status: 401 });
  }
  try {
    const storage = new GoTabIntegrationStorage();
    const [mappings, activity, projectionExceptions] = await Promise.all([
      storage.listMappings(),
      storage.listActivity(),
      storage.listExceptions(),
    ]);
    const exceptions = activity.filter((item) =>
      ["FAILED", "NEEDS_PRODUCT_MAPPING", "NEEDS_REVIEW"].includes(item.dispatch_status),
    );
    return NextResponse.json({ mappings, activity, exceptions, projectionExceptions });
  } catch {
    if (process.env.NODE_ENV !== "production") {
      return NextResponse.json(localPreviewOperations());
    }
    return NextResponse.json(
      { error: "GoTab operational data is unavailable. Apply the Event Food migration first." },
      { status: 503 },
    );
  }
}

function localPreviewOperations() {
  const createdAt = "2026-08-15T17:00:00.000Z";
  const verifiedProductUuids: Record<string, string> = {
    "platter-tater-kegs": "prd_4EGxn~hzX94JKyomJjb9f09T",
    "platter-chicken-tenders": "prd_x1R9l1G~G3JvH9QsgbFYlWR6",
    "platter-mozzarella-sticks": "prd_r9_GAyvRBsWq9ZGdv9YWxvqL",
    "platter-wings": "prd_Ygwt7EFZ1Za6XPC50OBinTq3",
    "platter-fries": "prd_L2rZUgTm4zy06mSc2JZky5BP",
    "platter-veggie-tray": "prd_AH1OPNSuHFaiMCT5cixMrLud",
    "dessert-platter": "prd_Q8wldxCOuOiElNL_3pxMpVDP",
    "refill-taco-beef": "prd_bGlSvHq~dy9QbtdEXqBKW5Y0",
    "refill-taco-chicken": "prd_XrI9ZCzsIteJV0Gqz6S2j5Fr",
    "refill-black-beans": "prd_v9fl2nUni3QQAME8OeZvrSOQ",
    "refill-tortillas": "prd_gamBENwj2AJBUbUIw~boSC2e",
    "refill-lettuce-wraps": "prd_xGcUZCrlmWRjQWHNLVJrbypQ",
    "refill-tomato": "prd_Sy0RFPDLIbkfujg73Y2UxAh2",
    "refill-lettuce": "prd_Q29IkXou3SgXNiYKW0OaYq9E",
    "refill-sour-cream": "prd_tagjc7bj9rjp2ji41BbNkMbs",
    "refill-onion": "prd_U_nN8bGXnhg8e6DrgJEIWXxk",
    "refill-cheese": "prd_diqzv5vanLasQhulIvB7mBxL",
    "refill-salsa": "prd_HZCkuArB1_UbPCQ0RFQNfqNM",
    "addon:wings": "prd_Ygwt7EFZ1Za6XPC50OBinTq3",
    "addon:fry-platters": "prd_L2rZUgTm4zy06mSc2JZky5BP",
    "addon:tater-kegs": "prd_4EGxn~hzX94JKyomJjb9f09T",
    "addon:mozzarella-sticks": "prd_r9_GAyvRBsWq9ZGdv9YWxvqL",
    "addon:chicken-tenders": "prd_x1R9l1G~G3JvH9QsgbFYlWR6",
    "addon:veggie-tray": "prd_AH1OPNSuHFaiMCT5cixMrLud",
    "addon:dessert-platter": "prd_Q8wldxCOuOiElNL_3pxMpVDP",
  };
  const mappingRows = [
    ["platter-tater-kegs", "Tater Kegs", "THIRD_PAN", "FRYER"],
    ["platter-tater-kegs", "Tater Kegs", "HALF_PAN", "FRYER"],
    ["platter-chicken-tenders", "Chicken Tenders", "THIRD_PAN", "FRYER"],
    ["platter-chicken-tenders", "Chicken Tenders", "HALF_PAN", "FRYER"],
    ["platter-mozzarella-sticks", "Mozzarella Sticks", "THIRD_PAN", "FRYER"],
    ["platter-mozzarella-sticks", "Mozzarella Sticks", "HALF_PAN", "FRYER"],
    ["platter-wings", "Wings", "THIRD_PAN", "FRYER"],
    ["platter-wings", "Wings", "HALF_PAN", "FRYER"],
    ["platter-fries", "Fries", "THIRD_PAN", "FRYER"],
    ["platter-fries", "Fries", "HALF_PAN", "FRYER"],
    ["platter-veggie-tray", "Veggie Tray", "TRAY", "COLD_PREP"],
    ["dessert-platter", "Assorted Desserts", "TRAY", "COLD_PREP"],
    ["refill-taco-beef", "Taco Beef Refill", "REFILL", "GRILL"],
    ["refill-taco-chicken", "Taco Chicken Refill", "REFILL", "GRILL"],
    ["refill-black-beans", "Black Beans Refill", "REFILL", "EXPO"],
    ["refill-tortillas", "Tortilla Refill", "REFILL", "COLD_PREP"],
    ["refill-lettuce-wraps", "Lettuce Wrap Refill", "REFILL", "COLD_PREP"],
    ["refill-tomato", "Tomato Refill", "REFILL", "COLD_PREP"],
    ["refill-lettuce", "Lettuce Refill", "REFILL", "COLD_PREP"],
    ["refill-sour-cream", "Sour Cream Refill", "REFILL", "COLD_PREP"],
    ["refill-onion", "Diced Onion Refill", "REFILL", "COLD_PREP"],
    ["refill-cheese", "Shredded Cheese Refill", "REFILL", "COLD_PREP"],
    ["refill-salsa", "Salsa Refill", "REFILL", "COLD_PREP"],
    ["addon:wings", "Wings", "THIRD_PAN", "FRYER"],
    ["addon:wings", "Wings", "HALF_PAN", "FRYER"],
    ["addon:fry-platters", "Fries", "THIRD_PAN", "FRYER"],
    ["addon:fry-platters", "Fries", "HALF_PAN", "FRYER"],
    ["addon:tater-kegs", "Tater Kegs", "THIRD_PAN", "FRYER"],
    ["addon:tater-kegs", "Tater Kegs", "HALF_PAN", "FRYER"],
    ["addon:mozzarella-sticks", "Mozzarella Sticks", "THIRD_PAN", "FRYER"],
    ["addon:mozzarella-sticks", "Mozzarella Sticks", "HALF_PAN", "FRYER"],
    ["addon:chicken-tenders", "Chicken Tenders", "THIRD_PAN", "FRYER"],
    ["addon:chicken-tenders", "Chicken Tenders", "HALF_PAN", "FRYER"],
    ["addon:veggie-tray", "Veggie Tray", "TRAY", "COLD_PREP"],
    ["addon:dessert-platter", "Assorted Desserts", "TRAY", "COLD_PREP"],
    ["addon:ranch", "Ranch", "BOWL", "COLD_PREP"],
    ["addon:bbq-sauce", "BBQ Sauce", "BOWL", "COLD_PREP"],
    ["addon:garlic-parm", "Garlic Parm", "BOWL", "COLD_PREP"],
    ["addon:buffalo-sauce", "Buffalo Sauce", "BOWL", "COLD_PREP"],
  ];
  const mappings = mappingRows.map(([key, name, panSize, station], index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    canonical_product_key: key,
    source_system: "EVENT_HOST",
    source_product_key: key,
    source_product_name: name,
    aliases: [],
    display_name: name,
    pan_size: panSize,
    preparation_station: station,
    gotab_product_uuid: verifiedProductUuids[key] ?? null,
    mapping_status: verifiedProductUuids[key] ? "VERIFIED" : "NEEDS_MAPPING",
    verified_at: verifiedProductUuids[key] ? createdAt : null,
    updated_at: createdAt,
  }));
  const activity = [{
    id: "44444444-4444-4444-8444-444444444444",
    event_id: "123456",
    event_name: "OPE KDS Integration Test",
    source_type: "TRIPLESEAT_CONTRACT",
    display_name: "Mozzarella Sticks",
    pan_size: "THIRD_PAN",
    quantity: 3,
    preparation_station: "FRYER",
    food_service_time: "2026-08-15T21:45:00.000Z",
    prep_due_at: "2026-08-15T20:45:00.000Z",
    requester_name: null,
    dispatch_status: "SCHEDULED",
    gotab_order_uuid: null,
    retry_count: 0,
    failure_reason: null,
    dispatched_at: null,
    created_at: createdAt,
  }];
  return {
    mappings,
    activity,
    exceptions: [],
    projectionExceptions: [{
      id: "55555555-5555-4555-8555-555555555555",
      event_id: "123456",
      source_type: "TRIPLESEAT_CONTRACT",
      source_version: 1,
      item_key: "platter-veggie-tray",
      food_name: "Veggie Tray",
      reason: "A verified GoTab product mapping is required.",
      status: "OPEN",
      created_at: createdAt,
    }],
    error: "LOCAL UI SAMPLE — the Event Food migration has not been applied and these rows are not live data.",
  };
}

export async function PATCH(request: Request) {
  if (!(await authorized())) {
    return NextResponse.json({ error: "Admin session required." }, { status: 401 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const gotabProductUuid = typeof body?.gotabProductUuid === "string"
    ? body.gotabProductUuid.trim() || null
    : null;
  const preparationStation = typeof body?.preparationStation === "string" ? body.preparationStation : "";
  const panSize = typeof body?.panSize === "string" ? body.panSize : "";
  const mappingStatus = typeof body?.mappingStatus === "string" ? body.mappingStatus : "";
  if (
    !/^[0-9a-f-]{36}$/i.test(id) ||
    !STATIONS.has(preparationStation) ||
    !PAN_SIZES.has(panSize) ||
    !MAPPING_STATUSES.has(mappingStatus) ||
    (["MAPPED", "VERIFIED"].includes(mappingStatus) && !gotabProductUuid) ||
    (gotabProductUuid != null && gotabProductUuid.length > 128)
  ) {
    return NextResponse.json({ error: "Invalid product mapping update." }, { status: 400 });
  }
  try {
    const mapping = await new GoTabIntegrationStorage().updateMapping(id, {
      gotabProductUuid,
      preparationStation,
      panSize,
      mappingStatus: mappingStatus as "NEEDS_MAPPING" | "MAPPED" | "VERIFIED" | "DISABLED",
    });
    return NextResponse.json({ mapping });
  } catch {
    return NextResponse.json({ error: "Product mapping could not be saved." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!(await authorized())) {
    return NextResponse.json({ error: "Admin session required." }, { status: 401 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : "";
  const action = typeof body?.action === "string" ? body.action : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(requestId) || !["HOLD", "SEND_NOW", "RETRY", "CANCEL"].includes(action) || !reason || reason.length > 500) {
    return NextResponse.json({ error: "A valid request, action, and reason are required." }, { status: 400 });
  }
  try {
    const result = await new GoTabIntegrationStorage().performAdministrativeAction({
      requestId,
      action: action as "HOLD" | "SEND_NOW" | "RETRY" | "CANCEL",
      actor: "EVENT_HOST_ADMIN",
      reason,
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "The dispatch action could not be completed." }, { status: 409 });
  }
}
