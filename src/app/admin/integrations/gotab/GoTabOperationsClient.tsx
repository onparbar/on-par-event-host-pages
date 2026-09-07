"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  StoredEventFoodActivity,
  StoredEventFoodException,
  StoredEventFoodMapping,
} from "@/lib/gotab/storage";
import type { GoTabEventFoodProduct } from "@/lib/gotab/client";

type OperationsPayload = {
  mappings: StoredEventFoodMapping[];
  activity: StoredEventFoodActivity[];
  exceptions: StoredEventFoodActivity[];
  projectionExceptions: StoredEventFoodException[];
  error?: string;
};

type Tab = "mapping" | "catalog" | "activity" | "exceptions" | "preview";

const PAN_SIZES = ["THIRD_PAN", "HALF_PAN", "FULL_PAN", "TRAY", "EACH", "DOZEN", "BOWL", "REFILL", "NOT_APPLICABLE"];
const STATIONS = ["EXPO", "FRYER", "GRILL", "COLD_PREP"];
const MAPPING_STATUSES = ["NEEDS_MAPPING", "MAPPED", "VERIFIED", "DISABLED"];

export default function GoTabOperationsClient() {
  const [payload, setPayload] = useState<OperationsPayload | null>(null);
  const [tab, setTab] = useState<Tab>("mapping");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<GoTabEventFoodProduct[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);

  async function load() {
    const response = await fetch("/api/gotab/operations", { cache: "no-store" });
    const result = await response.json() as Partial<OperationsPayload>;
    const next: OperationsPayload = {
      mappings: Array.isArray(result.mappings) ? result.mappings : [],
      activity: Array.isArray(result.activity) ? result.activity : [],
      exceptions: Array.isArray(result.exceptions) ? result.exceptions : [],
      projectionExceptions: Array.isArray(result.projectionExceptions) ? result.projectionExceptions : [],
      error: result.error,
    };
    setPayload(next);
    if (!selectedId && next.activity?.[0]) setSelectedId(next.activity[0].id);
  }

  useEffect(() => {
    void load().catch(() => setPayload({ mappings: [], activity: [], exceptions: [], projectionExceptions: [], error: "Unable to load GoTab operations." }));
  }, []);

  const selected = useMemo(
    () => payload?.activity.find((item) => item.id === selectedId) ?? null,
    [payload, selectedId],
  );

  async function saveMapping(mapping: StoredEventFoodMapping) {
    setMessage("Saving mapping…");
    const response = await fetch("/api/gotab/operations", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: mapping.id,
        gotabProductUuid: mapping.gotab_product_uuid,
        preparationStation: mapping.preparation_station,
        panSize: mapping.pan_size,
        mappingStatus: mapping.mapping_status,
      }),
    });
    const result = await response.json() as { mapping?: StoredEventFoodMapping; error?: string };
    if (!response.ok || !result.mapping) {
      setMessage(result.error ?? "Mapping could not be saved.");
      return;
    }
    setPayload((current) => current ? {
      ...current,
      mappings: current.mappings.map((item) => item.id === result.mapping!.id ? result.mapping! : item),
    } : current);
    setMessage("Mapping saved.");
  }

  async function refreshCatalog() {
    setCatalogLoading(true);
    setMessage("Refreshing the read-only Event Food catalog…");
    try {
      const response = await fetch("/api/gotab/catalog", { method: "POST" });
      const result = await response.json() as { products?: GoTabEventFoodProduct[]; error?: string };
      if (!response.ok || !Array.isArray(result.products)) {
        setMessage(result.error ?? "The Event Food catalog could not be refreshed.");
        return;
      }
      setCatalog(result.products);
      setMessage(`Found ${result.products.length} Event Food products. No GoTab records were changed.`);
    } finally {
      setCatalogLoading(false);
    }
  }

  async function dispatchAction(action: "HOLD" | "SEND_NOW" | "RETRY" | "CANCEL") {
    if (!selected) return;
    const reason = window.prompt(`Reason for ${action.replaceAll("_", " ").toLowerCase()}:`)?.trim();
    if (!reason) return;
    setMessage("Saving dispatch action…");
    const response = await fetch("/api/gotab/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: selected.id, action, reason }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      setMessage(result.error ?? "Dispatch action could not be completed.");
      return;
    }
    setMessage(`${action.replaceAll("_", " ")} saved.`);
    await load();
  }

  function changeMapping(id: string, update: Partial<StoredEventFoodMapping>) {
    setPayload((current) => current ? {
      ...current,
      mappings: current.mappings.map((item) => item.id === id ? { ...item, ...update } : item),
    } : current);
  }

  if (!payload) return <section className="portal-card gotab-empty-state">Loading kitchen dispatch records…</section>;

  return (
    <section className="portal-card gotab-operations-card">
      <div className="gotab-tab-list" role="tablist" aria-label="GoTab administration">
        <TabButton active={tab === "mapping"} onClick={() => setTab("mapping")}>Product Mapping</TabButton>
        <TabButton active={tab === "catalog"} onClick={() => setTab("catalog")}>Catalog Preview</TabButton>
        <TabButton active={tab === "activity"} onClick={() => setTab("activity")}>Dispatch Activity</TabButton>
        <TabButton active={tab === "exceptions"} onClick={() => setTab("exceptions")}>Exceptions ({payload.exceptions.length + payload.projectionExceptions.length})</TabButton>
        <TabButton active={tab === "preview"} onClick={() => setTab("preview")}>KDS Preview</TabButton>
      </div>

      {payload.error ? <div className="gotab-phase-notice" role="status"><strong>Phase 1 preview</strong><span>{payload.error}</span></div> : null}
      {message ? <p className="gotab-inline-message" role="status">{message}</p> : null}

      {tab === "mapping" ? (
        <div className="gotab-table-scroll">
          <table className="gotab-admin-table">
            <thead><tr><th>Source product</th><th>Canonical key</th><th>GoTab product UUID</th><th>Pan size</th><th>Station</th><th>Status</th><th /></tr></thead>
            <tbody>{payload.mappings.map((mapping) => (
              <tr key={mapping.id}>
                <td><strong>{mapping.source_product_name}</strong><small>{mapping.source_system}</small></td>
                <td><code>{mapping.canonical_product_key}</code></td>
                <td><input aria-label={`${mapping.source_product_name} GoTab product UUID`} value={mapping.gotab_product_uuid ?? ""} onChange={(event) => changeMapping(mapping.id, { gotab_product_uuid: event.target.value || null })} /></td>
                <td><select value={mapping.pan_size} onChange={(event) => changeMapping(mapping.id, { pan_size: event.target.value })}>{PAN_SIZES.map((value) => <option key={value}>{value}</option>)}</select></td>
                <td><select value={mapping.preparation_station} onChange={(event) => changeMapping(mapping.id, { preparation_station: event.target.value })}>{STATIONS.map((value) => <option key={value}>{value}</option>)}</select></td>
                <td><select value={mapping.mapping_status} onChange={(event) => changeMapping(mapping.id, { mapping_status: event.target.value as StoredEventFoodMapping["mapping_status"] })}>{MAPPING_STATUSES.map((value) => <option key={value}>{value}</option>)}</select></td>
                <td><button className="button-link" type="button" onClick={() => void saveMapping(mapping)}>Save</button></td>
              </tr>
            ))}</tbody>
          </table>
          {!payload.mappings.length ? <Empty>No product mappings have been imported yet.</Empty> : null}
        </div>
      ) : null}

      {tab === "catalog" ? (
        <div className="gotab-table-scroll">
          <div className="gotab-catalog-toolbar">
            <div><strong>GoTab Event Food catalog</strong><small>Read-only. This does not create or edit GoTab products.</small></div>
            <button className="button-link" disabled={catalogLoading} onClick={() => void refreshCatalog()} type="button">
              {catalogLoading ? "Refreshing…" : "Refresh catalog"}
            </button>
          </div>
          {catalog ? (
            <table className="gotab-admin-table">
              <thead><tr><th>GoTab product</th><th>Product UUID</th><th>Current mapping</th></tr></thead>
              <tbody>{catalog.map((product) => {
                const mapped = payload.mappings.filter((mapping) => mapping.gotab_product_uuid === product.productUuid);
                return <tr key={product.productUuid}><td><strong>{product.name}</strong></td><td><code>{product.productUuid}</code></td><td>{mapped.length ? mapped.map((mapping) => mapping.canonical_product_key).join(", ") : "Not mapped"}</td></tr>;
              })}</tbody>
            </table>
          ) : <Empty>Select Refresh catalog to preview the products currently under GoTab’s Event Food category.</Empty>}
        </div>
      ) : null}

      {tab === "activity" ? (
        <ActivityTable
          items={payload.activity}
          onPreview={(id) => { setSelectedId(id); setTab("preview"); }}
        />
      ) : null}

      {tab === "exceptions" ? (
        <div>
          <ProjectionExceptions items={payload.projectionExceptions} />
          <ActivityTable items={payload.exceptions} onPreview={(id) => { setSelectedId(id); setTab("preview"); }} />
        </div>
      ) : null}

      {tab === "preview" ? (
        <div className="gotab-preview-layout">
          <label>Request to preview<select value={selectedId ?? ""} onChange={(event) => setSelectedId(event.target.value)}><option value="">Select a request</option>{payload.activity.map((item) => <option key={item.id} value={item.id}>{item.event_name} — {item.display_name}</option>)}</select></label>
          {selected ? <KdsPreview item={selected} onAction={dispatchAction} /> : <Empty>Select a dispatch request to preview its kitchen ticket.</Empty>}
        </div>
      ) : null}
    </section>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button aria-selected={active} className={active ? "active" : ""} onClick={onClick} role="tab" type="button">{children}</button>;
}

function ActivityTable({ items, onPreview }: { items: StoredEventFoodActivity[]; onPreview: (id: string) => void }) {
  return <div className="gotab-table-scroll"><table className="gotab-admin-table"><thead><tr><th>Event</th><th>Food</th><th>Pan / Qty</th><th>Source</th><th>Service</th><th>Station</th><th>Status</th><th>Retries</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.event_name}</strong><small>{item.event_id}</small></td><td>{item.display_name}</td><td>{item.pan_size} × {item.quantity}</td><td>{item.source_type}</td><td>{formatDate(item.food_service_time)}</td><td>{item.preparation_station}</td><td><span className={`gotab-state gotab-state-${item.dispatch_status.toLowerCase()}`}>{item.dispatch_status.replaceAll("_", " ")}</span>{item.failure_reason ? <small>{item.failure_reason}</small> : null}</td><td>{item.retry_count}</td><td><button className="button-link" type="button" onClick={() => onPreview(item.id)}>Preview</button></td></tr>)}</tbody></table>{!items.length ? <Empty>No records in this section.</Empty> : null}</div>;
}

function ProjectionExceptions({ items }: { items: StoredEventFoodException[] }) {
  if (!items.length) return null;
  return <div className="gotab-table-scroll"><table className="gotab-admin-table"><thead><tr><th>Event ID</th><th>Food</th><th>Source</th><th>Version</th><th>Reason</th><th>Status</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{item.event_id}</td><td><strong>{item.food_name}</strong><small>{item.item_key}</small></td><td>{item.source_type}</td><td>{item.source_version}</td><td>{item.reason}</td><td><span className="gotab-state gotab-state-needs_review">{item.status}</span></td></tr>)}</tbody></table></div>;
}

function KdsPreview({ item, onAction }: { item: StoredEventFoodActivity; onAction: (action: "HOLD" | "SEND_NOW" | "RETRY" | "CANCEL") => Promise<void> }) {
  const label = item.source_type === "REFILL" ? "REFILL" : item.source_type === "VIP_ADDON" ? "VIP" : item.source_type === "CORRECTION" ? "CORRECTION" : "EVENT";
  return <article className="gotab-kds-preview"><header><span>DRY-RUN KDS PREVIEW</span><strong>[{label}] {item.event_name}</strong></header><dl><div><dt>Product</dt><dd>{item.display_name}</dd></div><div><dt>Pan size</dt><dd>{item.pan_size.replaceAll("_", " ")}</dd></div><div><dt>Quantity</dt><dd>{item.quantity}</dd></div><div><dt>Station</dt><dd>{item.preparation_station}</dd></div><div><dt>Food service</dt><dd>{formatDate(item.food_service_time)}</dd></div><div><dt>Requested by</dt><dd>{item.requester_name || "Not entered"}</dd></div><div><dt>Status</dt><dd>{item.dispatch_status.replaceAll("_", " ")}</dd></div><div><dt>GoTab order</dt><dd>{item.gotab_order_uuid || "Not sent"}</dd></div></dl><p>No live GoTab order is created from this preview.</p><footer><button className="button-link" onClick={() => void onAction("SEND_NOW")} type="button">Send now</button><button className="button-link" onClick={() => void onAction("HOLD")} type="button">Hold</button>{item.dispatch_status === "FAILED" ? <button className="button-link" onClick={() => void onAction("RETRY")} type="button">Retry</button> : null}<button className="button-link" onClick={() => void onAction("CANCEL")} type="button">Cancel pending</button></footer></article>;
}

function Empty({ children }: { children: React.ReactNode }) { return <div className="gotab-empty-state">{children}</div>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
