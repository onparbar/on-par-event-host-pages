"use client";

import { useEffect, useRef, useState } from "react";
import {
  appetizerBarRefillAddOns,
  currency,
  entertainmentAddOns,
  entertainmentUnitPrice,
  foodUnitPrice,
  isWeekendRateEvent,
  standardFoodAddOns,
  tacoBarRefillAddOns,
  wingBarRefillAddOns,
  type EntertainmentState,
} from "@/lib/checklist-model";
import { KITCHEN_EVENT_ADD_ON_FIELDS } from "@/lib/kitchen/addons";
import styles from "./AddOnQuickOrder.module.css";

export type QuickOrderInput = {
  category: "food" | "refills" | "entertainment";
  key: string;
  quantity: string;
  panSize: "" | "1/3" | "1/2";
  notes: string;
  selectedRateKey: string;
  manualPrice: string;
};

export type QuickOrderResult = "accepted" | "pending" | "error" | "uncertain";
const refillGroups = [
  { label: "Appetizer Bar", items: appetizerBarRefillAddOns },
  { label: "Wing Bar", items: wingBarRefillAddOns },
  { label: "Taco Bar", items: tacoBarRefillAddOns },
];
const pannedFoodKeys = new Set(["wings", "mozzarella-sticks", "tater-kegs", "fry-platters", "chicken-tenders"]);

export function quickOrderQuantityError(order: QuickOrderInput) {
  const quantity = Number(order.quantity);
  const entertainment = order.category === "entertainment" ? entertainmentAddOns.find((item) => item.key === order.key) : undefined;
  const hours = entertainment?.unitLabel === "hours";
  if (!order.quantity || !/^\d+(?:\.\d+)?$/.test(order.quantity) || !Number.isFinite(quantity) || quantity <= 0 || quantity > Number.MAX_SAFE_INTEGER) return "Enter a quantity greater than zero.";
  if (!hours && !Number.isSafeInteger(quantity)) return "Enter a whole-number quantity.";
  if (order.category === "entertainment") {
    if (!entertainment) return "Choose an entertainment add-on.";
    if (entertainment.kind === "manual-price" && (!/^\d+(?:\.\d{1,2})?$/.test(order.manualPrice) || Number(order.manualPrice) <= 0)) return "Enter the price per card.";
    if (entertainment.kind === "rate-select" && !entertainment.options?.some((option) => option.key === order.selectedRateKey)) return "Choose a rate.";
  } else {
    const catalog = order.category === "food" ? standardFoodAddOns : refillGroups.flatMap((group) => group.items);
    if (!catalog.some((item) => item.key === order.key)) return "Choose a food item.";
    const field = KITCHEN_EVENT_ADD_ON_FIELDS.find((item) => item.sourceKey === order.key);
    if (!field) return "Choose a food item.";
    if (quantity > field.maxSourceQuantity) return `Enter no more than ${field.maxSourceQuantity} for one order.`;
  }
  return "";
}

export function isValidQuickOrder(order: QuickOrderInput) {
  if (!order || !["food", "refills", "entertainment"].includes(order.category) ||
    typeof order.key !== "string" || typeof order.quantity !== "string" ||
    typeof order.notes !== "string" || order.notes.length > 500 ||
    typeof order.selectedRateKey !== "string" || typeof order.manualPrice !== "string" ||
    !["", "1/2", "1/3"].includes(order.panSize)) return false;
  if (order.panSize && (order.category !== "food" || !pannedFoodKeys.has(order.key) || order.key === "fry-platters" && order.panSize === "1/3")) return false;
  return quickOrderQuantityError(order) === "";
}

export function quickOrderKeypadValue(value: string, key: string, decimal: boolean) {
  if (key === "clear") return "";
  if (key === "delete") return value.slice(0, -1);
  if (key === ".") return decimal && !value.includes(".") ? `${value || "0"}.` : value;
  if (!/^\d$/.test(key)) return value;
  return value === "0" ? key : `${value}${key}`;
}

export function addQuickOrderQuantity(current: string, added: string): string | null {
  const values = [current || "0", added];
  if (values.some((value) => !/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)))) return null;
  const parts = values.map((value) => value.split("."));
  const scale = Math.max(...parts.map(([, decimal = ""]) => decimal.length));
  const total = parts.reduce((sum, [whole, decimal = ""]) => sum + BigInt(`${whole}${decimal.padEnd(scale, "0")}`), BigInt(0));
  if (total > BigInt(`${Number.MAX_SAFE_INTEGER}${"0".repeat(scale)}`)) return null;
  const digits = total.toString().padStart(scale + 1, "0");
  if (!scale) return digits;
  const decimal = digits.slice(-scale).replace(/0+$/, "");
  return `${digits.slice(0, -scale)}${decimal ? `.${decimal}` : ""}`;
}

export default function AddOnQuickOrder({ eventName, eventDate, disabled, isItemLocked, onSubmit, errorMessage = "", existingEntertainment = {}, getItemResult }: {
  eventName: string;
  eventDate: string;
  disabled: boolean;
  isItemLocked: (key: string) => boolean;
  onSubmit: (order: QuickOrderInput) => Promise<QuickOrderResult>;
  errorMessage?: string;
  existingEntertainment?: Record<string, EntertainmentState>;
  getItemResult?: (key: string) => QuickOrderResult | null;
}) {
  const [order, setOrder] = useState<QuickOrderInput | null>(null);
  const [result, setResult] = useState<QuickOrderResult | "sending" | null>(null);
  const [validationError, setValidationError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  useEffect(() => {
    if (order && !dialog.current?.open) dialog.current?.showModal();
    if (!order && dialog.current?.open) dialog.current.close();
  }, [order]);
  useEffect(() => {
    if (result !== "pending" || !order || !getItemResult) return;
    const current = getItemResult(order.key);
    if (current && current !== "pending") setResult(current);
  }, [result, order?.key, getItemResult]);

  const entertainment = order?.category === "entertainment" ? entertainmentAddOns.find((item) => item.key === order.key) : undefined;
  const existingEntertainmentRate = entertainment && Number(existingEntertainment[entertainment.key]?.quantity) > 0 ? existingEntertainment[entertainment.key] : null;
  const food = order?.category === "food" ? standardFoodAddOns.find((item) => item.key === order.key) : undefined;
  const refillGroup = order?.category === "refills" ? refillGroups.find((group) => group.items.some((item) => item.key === order.key)) : undefined;
  const refill = refillGroup?.items.find((item) => item.key === order?.key);
  const item = entertainment ?? food ?? refill;
  const decimal = entertainment?.unitLabel === "hours";
  const settled = result === "accepted" || result === "pending" || result === "uncertain";
  const locked = disabled || Boolean(order && isItemLocked(order.key)) || result === "sending" || settled;
  const field = order && order.category !== "entertainment" ? KITCHEN_EVENT_ADD_ON_FIELDS.find((entry) => entry.sourceKey === order.key) : undefined;
  const unit = entertainment?.unitLabel ?? field?.sourceUnitLabel ?? "items";
  const unitPrice = order && food ? foodUnitPrice(food, order) : order && entertainment ? entertainmentUnitPrice(entertainment, order) : null;
  const quantityError = order ? quickOrderQuantityError(order) : "";

  function choose(category: QuickOrderInput["category"], key: string) {
    if (!key || disabled || isItemLocked(key)) return;
    setValidationError("");
    setResult(null);
    const existing = category === "entertainment" && Number(existingEntertainment[key]?.quantity) > 0 ? existingEntertainment[key] : null;
    setOrder({ category, key, quantity: "", panSize: "", notes: "", selectedRateKey: existing?.selectedRateKey ?? (isWeekendRateEvent(eventDate) ? "fri-sat" : "sun-thu"), manualPrice: existing?.manualPrice ?? "" });
  }
  function update(changes: Partial<QuickOrderInput>) {
    if (locked) return;
    setOrder((current) => current ? { ...current, ...changes } : current);
    setValidationError("");
    setResult(null);
  }
  function close() {
    if (submitting.current) return;
    setOrder(null);
    setResult(null);
  }
  async function submit() {
    if (!order || locked || submitting.current) return;
    const error = quickOrderQuantityError(order);
    if (error) { setValidationError(error); return; }
    submitting.current = true;
    setResult("sending");
    try {
      setResult(await onSubmit(order));
    } catch {
      // A lost response is not evidence that an order failed. Never offer a blind retry.
      setResult("uncertain");
    } finally { submitting.current = false; }
  }

  return <section className={styles.quickOrder} aria-label="Add-ons and refills">
    <div className={styles.categories}>
      <label className={styles.category}><span>Food Add-Ons</span><select aria-label="Food Add-Ons" value="" disabled={disabled} onChange={(event) => choose("food", event.target.value)}><option value="">Choose food…</option>{standardFoodAddOns.map((entry) => <option key={entry.key} value={entry.key} disabled={isItemLocked(entry.key)}>{entry.label}{entry.fixedPrice !== undefined ? ` · ${currency(entry.fixedPrice)}` : ""}</option>)}</select><small>Send to Kitchen + KDS</small></label>
      <label className={styles.category}><span>Bar Refills</span><select aria-label="Bar Refills" value="" disabled={disabled} onChange={(event) => choose("refills", event.target.value)}><option value="">Choose a refill…</option>{refillGroups.map((group) => <optgroup label={group.label} key={group.label}>{group.items.map((entry) => <option key={entry.key} value={entry.key} disabled={isItemLocked(entry.key)}>{entry.label}</option>)}</optgroup>)}</select><small>Appetizer, Wing + Taco Bar</small></label>
      <label className={styles.category}><span>Entertainment Add-Ons</span><select aria-label="Entertainment Add-Ons" value="" disabled={disabled} onChange={(event) => choose("entertainment", event.target.value)}><option value="">Choose entertainment…</option>{entertainmentAddOns.map((entry) => <option key={entry.key} value={entry.key} disabled={isItemLocked(entry.key)}>{entry.label}</option>)}</select><small>Save to the event record · not KDS</small></label>
    </div>
    <dialog className={styles.dialog} ref={dialog} aria-labelledby="quick-order-title" aria-describedby="quick-order-event" onCancel={(event) => { if (submitting.current) event.preventDefault(); else close(); }} onClose={() => { if (!submitting.current) setOrder(null); }}>
      {order && item ? <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <header className={styles.header}><div><small id="quick-order-event">{eventName}{refillGroup ? ` · ${refillGroup.label} refill` : ""}</small><h2 id="quick-order-title">{item.label}</h2></div><button type="button" aria-label="Close quantity keypad" disabled={result === "sending"} onClick={close}>×</button></header>
        {settled ? <div className={styles.result} role="status"><strong>{result === "accepted" ? order.category === "entertainment" ? "Add-on saved" : "GoTab accepted" : result === "pending" ? "Saved · sending to GoTab" : "Check the saved order"}</strong><p>{order.quantity} {unit} · {item.label}</p><p>{result === "accepted" ? order.category === "entertainment" ? "Saved to this event’s add-on record. No kitchen order or entertainment reservation was sent." : "The kitchen order was accepted by GoTab." : result === "pending" ? "Delivery updates automatically. Do not submit this order again." : "Acceptance could not be confirmed. Do not submit again until the saved order has been checked."}</p>{result === "uncertain" && errorMessage ? <p className={styles.error} role="alert">{errorMessage}</p> : null}<button className={styles.submit} type="button" onClick={close}>Done</button></div> : <>
          <label className={styles.quantity}><span>Quantity for this order <small>({unit})</small></span><input autoFocus aria-label="Quantity for this order" type="text" inputMode={decimal ? "decimal" : "numeric"} autoComplete="off" disabled={locked} value={order.quantity} onChange={(event) => { const value = event.target.value; if ((decimal ? /^\d*(?:\.\d*)?$/ : /^\d*$/).test(value)) update({ quantity: value }); }} placeholder="0" /></label>
          <div className={styles.keypad} aria-label="Quantity keypad">{["1", "2", "3", "4", "5", "6", "7", "8", "9", decimal ? "." : "clear", "0", "delete"].map((key) => <button type="button" key={key} disabled={locked} aria-label={key === "delete" ? "Delete last digit" : key === "clear" ? "Clear quantity" : key === "." ? "Decimal point" : key} onClick={() => update({ quantity: quickOrderKeypadValue(order.quantity, key, decimal) })}>{key === "delete" ? "⌫" : key === "clear" ? "Clear" : key}</button>)}</div>
          {food && pannedFoodKeys.has(food.key) ? <label className={styles.field}><span>Pan size</span><select disabled={locked} value={order.panSize} onChange={(event) => update({ panSize: event.target.value as QuickOrderInput["panSize"] })}><option value="">Automatic</option><option value="1/2">1/2 pan</option>{food.key !== "fry-platters" ? <option value="1/3">1/3 pan</option> : null}</select></label> : null}
          {entertainment?.kind === "rate-select" ? <label className={styles.field}><span>Rate</span><select disabled={locked || Boolean(existingEntertainmentRate)} value={order.selectedRateKey} onChange={(event) => update({ selectedRateKey: event.target.value })}>{entertainment.options?.map((rate) => <option key={rate.key} value={rate.key}>{rate.label}</option>)}</select>{existingEntertainmentRate ? <small>Uses the existing event rate.</small> : null}</label> : null}
          {entertainment?.kind === "manual-price" ? <label className={styles.field}><span>Price per card</span><input inputMode="decimal" type="number" min="0" step="0.01" disabled={locked || Boolean(existingEntertainmentRate)} value={order.manualPrice} placeholder="0.00" onChange={(event) => update({ manualPrice: event.target.value })} />{existingEntertainmentRate ? <small>Uses the existing price per card.</small> : null}</label> : null}
          {order.category !== "entertainment" ? <details className={styles.notes}><summary>Optional kitchen note</summary><textarea aria-label="Optional kitchen note" maxLength={500} disabled={locked} value={order.notes} onChange={(event) => update({ notes: event.target.value })} placeholder="Instructions for this order only" /></details> : <p className={styles.hint}>Saves to the event record only. Check availability and reserve entertainment in the schedule.</p>}
          {unitPrice !== null ? <p className={styles.price}>{currency(unitPrice)} per {unit === "hours" ? "hour" : unit === "cards" ? "card" : unit === "guests" ? "guest" : "item"}<strong>{currency(unitPrice * Number(order.quantity || 0))}</strong></p> : null}
          {validationError || order.quantity && quantityError || result === "error" ? <p className={styles.error} role="alert">{validationError || quantityError || errorMessage || "This order was not confirmed. Check its saved status before trying again."}</p> : null}
          <footer className={styles.actions}><button type="button" disabled={result === "sending"} onClick={close}>Cancel</button><button type="submit" className={styles.submit} disabled={locked || Boolean(quantityError)}>{result === "sending" ? "Submitting…" : order.category === "entertainment" ? "Submit Add-On" : "Submit to Kitchen"}</button></footer>
        </>}
      </form> : null}
    </dialog>
  </section>;
}
