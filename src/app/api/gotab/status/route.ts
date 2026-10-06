import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasAdminSession } from "@/lib/admin-auth";
import { GoTabClient } from "@/lib/gotab/client";
import {
  getGoTabConfigurationStatus,
  requireGoTabConfiguration,
} from "@/lib/gotab/config";
import { GoTabIntegrationStorage } from "@/lib/gotab/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function authorized() {
  return hasAdminSession(await cookies());
}

export async function GET() {
  if (!(await authorized())) {
    return NextResponse.json({ error: "Admin session required." }, { status: 401 });
  }
  return NextResponse.json({ configuration: getGoTabConfigurationStatus() });
}

export async function POST() {
  if (!(await authorized())) {
    return NextResponse.json({ error: "Admin session required." }, { status: 401 });
  }
  const status = getGoTabConfigurationStatus();
  if (!status.configured) {
    return NextResponse.json(
      { configuration: status, error: "GoTab server configuration is incomplete." },
      { status: 503 },
    );
  }
  const configuration = requireGoTabConfiguration();
  const check = await new GoTabClient(configuration).checkCapabilities();
  try {
    await new GoTabIntegrationStorage().saveCapabilityCheck(
      check,
      configuration.dryRun,
      configuration.enabled,
    );
  } catch {
    return NextResponse.json(
      {
        configuration: status,
        check,
        warning: "Capability check completed, but its sanitized status could not be saved.",
      },
      { status: check.connected ? 200 : 502 },
    );
  }
  return NextResponse.json(
    { configuration: status, check },
    { status: check.connected ? 200 : 502 },
  );
}

