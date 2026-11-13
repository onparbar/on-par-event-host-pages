"use client";

import { useState } from "react";
import type { GoTabCapabilityCheck } from "@/lib/gotab/client";
import type { GoTabConfigurationStatus } from "@/lib/gotab/config";

type Result = {
  configuration: GoTabConfigurationStatus;
  check?: GoTabCapabilityCheck;
  error?: string;
  warning?: string;
};

export default function GoTabStatusClient({
  initialConfiguration,
}: {
  initialConfiguration: GoTabConfigurationStatus;
}) {
  const [result, setResult] = useState<Result>({ configuration: initialConfiguration });
  const [checking, setChecking] = useState(false);

  async function verify() {
    setChecking(true);
    try {
      const response = await fetch("/api/gotab/status", { method: "POST" });
      const payload = (await response.json()) as Result;
      setResult(payload);
    } catch {
      setResult((current) => ({ ...current, error: "Unable to run the GoTab connection check." }));
    } finally {
      setChecking(false);
    }
  }

  const configuration = result.configuration;
  const check = result.check;
  return (
    <div className="gotab-status-stack">
      <section className="portal-card gotab-status-card">
        <div>
          <span className="portal-eyebrow">Dispatch safety</span>
          <h2>{configuration.dryRun ? "DRY-RUN MODE" : "Live mode"}</h2>
          <p>{configuration.enabled
            ? "The master switch is enabled. Live sends still require dry-run mode to be disabled and complete configuration."
            : "Live GoTab dispatch is disabled. Event Host continues to calculate and display kitchen food normally."}</p>
        </div>
        <button className="button-link" disabled={checking} onClick={() => void verify()} type="button">
          {checking ? "Checking…" : "Verify GoTab connection"}
        </button>
      </section>

      <section className="portal-card gotab-status-card">
        <div className="gotab-status-grid">
          <Status label="Configuration" value={configuration.configured ? "Complete" : "Incomplete"} />
          <Status label="Location UUID" value={configuration.locationUuid ?? "Not configured"} />
          <Status label="Connection" value={check ? (check.connected ? "Connected" : "Failed") : "Not checked"} />
          <Status label="Matched location" value={check?.matchedLocation?.name ?? "Not checked"} />
          <Status label="Product read" value={check?.catalogRead ?? "Not checked"} />
          <Status label="Menu read" value={check?.menuRead ?? "Not checked"} />
          <Status label="Product write" value={check?.productWrite ?? "Not checked"} />
          <Status label="Order create" value={check?.orderCreate ?? "Not checked"} />
          <Status label="Spot read" value={check?.spotRead ?? "Not checked"} />
          <Status label="Station read" value={check?.stationRead ?? "Not checked"} />
          <Status label="Webhook" value={configuration.configured ? "Configured" : "Incomplete"} />
          <Status label="Last check" value={check ? new Date(check.checkedAt).toLocaleString() : "Never"} />
        </div>
        {configuration.missingEnvironmentVariables.length ? (
          <p className="gotab-status-error">Missing server configuration: {configuration.missingEnvironmentVariables.join(", ")}</p>
        ) : null}
        {configuration.invalidEnvironmentVariables.length ? (
          <p className="gotab-status-error">Invalid server configuration: {configuration.invalidEnvironmentVariables.join(", ")}</p>
        ) : null}
        {result.error || check?.lastError ? <p className="gotab-status-error">{result.error || check?.lastError}</p> : null}
        {result.warning ? <p>{result.warning}</p> : null}
      </section>
    </div>
  );
}

function Status({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

