import "server-only";

export const GOTAB_REQUIRED_ENVIRONMENT_VARIABLES = [
  "GOTAB_API_ACCESS_ID",
  "GOTAB_API_ACCESS_SECRET",
  "GOTAB_LOCATION_UUID",
  "GOTAB_EVENT_SPOT_UUID",
  "GOTAB_EVENT_CUSTOMER_PHONE",
  "GOTAB_WEBHOOK_SECRET",
  "EVENT_KDS_ENABLED",
  "EVENT_KDS_DRY_RUN",
  "EVENT_KDS_DEFAULT_PREP_LEAD_MINUTES",
] as const;

export type GoTabEnvironmentVariable =
  (typeof GOTAB_REQUIRED_ENVIRONMENT_VARIABLES)[number];

export type GoTabConfiguration = {
  apiAccessId: string;
  apiAccessSecret: string;
  locationUuid: string;
  eventSpotUuid: string;
  eventCustomerPhone: string;
  webhookSecret: string;
  enabled: boolean;
  dryRun: boolean;
  defaultPrepLeadMinutes: number;
};

export type GoTabConfigurationStatus = {
  configured: boolean;
  dispatchAllowed: boolean;
  enabled: boolean;
  dryRun: boolean;
  locationUuid: string | null;
  defaultPrepLeadMinutes: number | null;
  missingEnvironmentVariables: GoTabEnvironmentVariable[];
  invalidEnvironmentVariables: GoTabEnvironmentVariable[];
};

type Environment = Readonly<Record<string, string | undefined>>;

export class GoTabConfigurationError extends Error {
  readonly missingEnvironmentVariables: GoTabEnvironmentVariable[];
  readonly invalidEnvironmentVariables: GoTabEnvironmentVariable[];

  constructor(status: GoTabConfigurationStatus) {
    const details = [
      ...status.missingEnvironmentVariables.map((name) => `Missing ${name}.`),
      ...status.invalidEnvironmentVariables.map((name) => `Invalid ${name}.`),
    ];
    super(details.join(" ") || "GoTab configuration is invalid.");
    this.name = "GoTabConfigurationError";
    this.missingEnvironmentVariables = status.missingEnvironmentVariables;
    this.invalidEnvironmentVariables = status.invalidEnvironmentVariables;
  }
}

function value(env: Environment, name: GoTabEnvironmentVariable) {
  return env[name]?.trim() ?? "";
}

function booleanValue(value: string) {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function getGoTabConfigurationStatus(
  env: Environment = process.env,
): GoTabConfigurationStatus {
  const missingEnvironmentVariables = GOTAB_REQUIRED_ENVIRONMENT_VARIABLES.filter(
    (name) => !value(env, name),
  );
  const invalidEnvironmentVariables: GoTabEnvironmentVariable[] = [];
  const enabled = booleanValue(value(env, "EVENT_KDS_ENABLED"));
  const dryRun = booleanValue(value(env, "EVENT_KDS_DRY_RUN"));
  const leadMinutes = Number(value(env, "EVENT_KDS_DEFAULT_PREP_LEAD_MINUTES"));

  if (value(env, "EVENT_KDS_ENABLED") && enabled === null) {
    invalidEnvironmentVariables.push("EVENT_KDS_ENABLED");
  }
  if (value(env, "EVENT_KDS_DRY_RUN") && dryRun === null) {
    invalidEnvironmentVariables.push("EVENT_KDS_DRY_RUN");
  }
  if (
    value(env, "EVENT_KDS_DEFAULT_PREP_LEAD_MINUTES") &&
    (!Number.isInteger(leadMinutes) || leadMinutes < 1 || leadMinutes > 1_440)
  ) {
    invalidEnvironmentVariables.push("EVENT_KDS_DEFAULT_PREP_LEAD_MINUTES");
  }

  const configured =
    missingEnvironmentVariables.length === 0 &&
    invalidEnvironmentVariables.length === 0;
  return {
    configured,
    dispatchAllowed: configured && enabled === true && dryRun === false,
    enabled: enabled ?? false,
    dryRun: dryRun ?? true,
    locationUuid: value(env, "GOTAB_LOCATION_UUID") || null,
    defaultPrepLeadMinutes:
      Number.isInteger(leadMinutes) && leadMinutes >= 1 && leadMinutes <= 1_440
        ? leadMinutes
        : null,
    missingEnvironmentVariables,
    invalidEnvironmentVariables,
  };
}

export function requireGoTabConfiguration(
  env: Environment = process.env,
): GoTabConfiguration {
  const status = getGoTabConfigurationStatus(env);
  if (!status.configured) throw new GoTabConfigurationError(status);
  return {
    apiAccessId: value(env, "GOTAB_API_ACCESS_ID"),
    apiAccessSecret: value(env, "GOTAB_API_ACCESS_SECRET"),
    locationUuid: value(env, "GOTAB_LOCATION_UUID"),
    eventSpotUuid: value(env, "GOTAB_EVENT_SPOT_UUID"),
    eventCustomerPhone: value(env, "GOTAB_EVENT_CUSTOMER_PHONE"),
    webhookSecret: value(env, "GOTAB_WEBHOOK_SECRET"),
    enabled: status.enabled,
    dryRun: status.dryRun,
    defaultPrepLeadMinutes: status.defaultPrepLeadMinutes!,
  };
}

export function assertLiveGoTabDispatch(configuration: GoTabConfiguration) {
  if (!configuration.enabled) {
    throw new GoTabConfigurationError({
      ...getGoTabConfigurationStatus(),
      configured: true,
      dispatchAllowed: false,
      missingEnvironmentVariables: [],
      invalidEnvironmentVariables: ["EVENT_KDS_ENABLED"],
    });
  }
  if (configuration.dryRun) {
    throw new GoTabConfigurationError({
      ...getGoTabConfigurationStatus(),
      configured: true,
      dispatchAllowed: false,
      missingEnvironmentVariables: [],
      invalidEnvironmentVariables: ["EVENT_KDS_DRY_RUN"],
    });
  }
}
