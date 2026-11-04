"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import type { EventServingPlan, ServingObject } from "@/lib/operations/serving-plan";
import { buildTableMockup, type Art } from "./table-mockup";
import styles from "./EventSetupDiagram.module.css";

function allObjects(objects: ServingObject[]): ServingObject[] {
  return objects.flatMap((item) => [item, ...allObjects(item.children ?? [])]);
}

function quantity(item: ServingObject) {
  return item.quantity === null ? "See item details" : `${item.quantity}${item.unit ? ` ${item.unit}` : ""}`;
}

export default function EventSetupDiagram({ plan }: { plan: EventServingPlan }) {
  const objects = allObjects(plan.objects);
  const mockup = buildTableMockup(plan);
  const items = objects;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((item) => item.id === selectedId);
  const dialog = useRef<HTMLDialogElement>(null);
  const dialogId = useId();
  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
    if (!selected && dialog.current?.open) dialog.current.close();
  }, [selected?.id]);

  if (plan.status === "no-food") return null;
  const identify = (item: ServingObject) => {
    if (item.id === selected?.id) dialog.current?.showModal();
    else setSelectedId(item.id);
  };
  return <section className={styles.card} aria-label="Event serving layout">
    <div className={styles.heading}><div><span className={styles.eyebrow}>Contract-driven setup</span><h2>What the setup should resemble</h2></div><span className={styles.status}>{plan.status === "needs-review" ? "Check flagged items" : "Serving plan ready"}</span></div>
    <p className={styles.intro}>Tap any item on the table to see its name, this event’s food contents, quantities and serving tools.</p>
    <p className={styles.totals}>{plan.plates === null ? "Plate total needs review" : `${plan.plates} plates · event total`}{plan.tacoStands === null ? " · Taco-stand total needs review" : plan.tacoStands > 0 ? ` · ${plan.tacoStands} taco stands · event total` : ""}</p>
    {plan.servingLines === 2 ? <p className={styles.mirrored}>Two mirrored serving lines: repeat the equipment arrangement on each line. Food is shared between the lines, not doubled. Plate and taco-stand totals above are for the entire event.</p> : null}
    <div className={styles.tables}>
      {Array.from({ length: mockup.tableCount }, (_, tableIndex) => <figure key={tableIndex} className={styles.figure} aria-label={tableIndex ? `Whole table mockup ${tableIndex + 1}` : "Whole table mockup"}>
        {mockup.tableCount > 1 ? <figcaption className={styles.tableTitle}>{tableIndex ? `Layout continuation ${tableIndex + 1}` : "Start of the serving line"}</figcaption> : null}
        <div className={styles.stage}><div className={`${styles.mockup} ${tableIndex ? styles.continuation : ""}`}>
          <img className={styles.furniture} src="/setup/empty-buffet-table-v1.png" width="1024" height="1536" alt={tableIndex ? "Equipment layout continuation on a black table with an emerald-green runner." : "Whole black buffet table with an emerald-green runner and two marble serving carts."} />
          <div className={styles.artwork} aria-hidden="true">{mockup.art.filter((item) => item.tableIndex === tableIndex).map((item) => <span key={item.key} data-equipment-sprite={item.sprite} className={styles.sprite} style={{ ...position(item), ...equipmentStyle(item), ...(item.rotate ? { transform: `rotate(${item.rotate}deg)` } : {}) }} />)}</div>
          {mockup.targets.filter((target) => target.tableIndex === tableIndex).map((target) => {
            const item = target.item;
            return <button key={target.id} className={styles.hotspot} data-serving-object={item.id} data-table-index={tableIndex} type="button" style={position(target)} aria-label={`Identify: ${item.label}`} aria-haspopup="dialog" aria-controls={dialogId} title={item.label} onClick={() => identify(item)}><span className={styles.srOnly}>{item.label} · {quantity(item)}{item.contents.length ? ` · ${item.contents.join(" · ")}` : ""}</span></button>;
          })}
        </div></div>
      </figure>)}
    </div>
    <p className={styles.measurements}>Rearranged equipment mockup · Not a scale drawing or physical-fit approval. Follow the clicked descriptions for this event’s exact contents and quantities. Buffet table: 8 ft × 3 ft (96 × 36 in). Two marble carts per serving line, each 21.5 × 15.5 in; together 21.5 × 31 in.</p>
    {mockup.crowded ? <p className={styles.mirrored}>The illustration continues to keep all equipment readable. Confirm equipment spacing before setup; these views do not change the event’s food-table reservation or purchased quantities.</p> : null}
    <label className={styles.picker}><span>Find an item</span><select value="" onChange={(change) => { const item = items.find((entry) => entry.id === change.target.value); if (item) identify(item); }}><option value="">Choose an object…</option>{items.map((item) => <option key={item.id} value={item.id}>{item.label} · {quantity(item)}</option>)}</select></label>
    <dialog ref={dialog} id={dialogId} className={styles.dialog} aria-labelledby={`${dialogId}-title`} aria-describedby={`${dialogId}-description`}>
      <form method="dialog"><button type="submit" aria-label="Close setup item details">Close</button></form>
      <span className={styles.eyebrow}>Event setup item</span><h2 id={`${dialogId}-title`}>{selected?.label}</h2>
      {selected ? <><p className={styles.quantity}>{quantity(selected)}</p><p id={`${dialogId}-description`}>{selected.description}</p>{selected.contents.length ? <ul>{selected.contents.map((content, index) => <li key={`${index}:${content}`}>{content}</li>)}</ul> : null}</> : <p id={`${dialogId}-description`} />}
    </dialog>
    <details className={styles.instructions}><summary>Build the serving line</summary><ObjectInstructions objects={plan.objects} /></details>
    <div className={styles.printGuide}><h3>Build the serving line</h3><ObjectInstructions objects={plan.objects} /></div>
  </section>;
}

function position(item: { left: number; top: number; width: number; height: number }): CSSProperties {
  return { left: `${item.left}%`, top: `${item.top}%`, width: `${item.width}%`, height: `${item.height}%` };
}

/** Reuse the equipment from the existing mockups; no new images or pictured food are generated. */
function equipmentStyle(item: Art): CSSProperties {
  const referenceCrops: Record<number, [number, number, number, number]> = {
    1: [29.4, 8.4, 15.6, 8.4], 2: [33.4, 1.8, 8.3, 6.4], 3: [46.2, 3.9, 7.5, 11.6],
    4: [38.5, 48.9, 23.4, 22], 5: [38.5, 48.9, 23.4, 22],
    7: [24.4, 61.4, 11.1, 2.8], 8: [24.6, 54.4, 10.6, 2.8],
    9: [27.2, 27.1, 14.6, 11.4], 10: [43.3, 25.6, 14.2, 12.8], 12: [35.7, 72.7, 27.7, 20.2],
  };
  const atlasCrops: Record<number, [number, number, number, number]> = {
    6: [55.1, 27, 14.9, 21.8], 15: [76.9, 79.4, 21.1, 17.9],
  };
  const lettuce = item.key === "taco-lettuce-wraps-plate";
  const dessert = item.key.startsWith("cold-platter-dessert") && item.key.endsWith("-plate");
  const [left, top, width, height] = lettuce ? [42.1, 41.1, 16, 5.7] : dessert ? [30.6, 78.8, 39, 12.5] : referenceCrops[item.sprite] ?? atlasCrops[item.sprite];
  return {
    backgroundImage: `url('/setup/${dessert ? "appetizer-wings-dessert-reference-v1.png" : lettuce || referenceCrops[item.sprite] ? "taco-bar-reference-v1.png" : "equipment-atlas-v2.png"}')`,
    backgroundSize: `${10000 / width}% ${10000 / height}%`,
    backgroundPosition: `${left / (100 - width) * 100}% ${top / (100 - height) * 100}%`,
    ...(item.sprite === 4 || item.sprite === 5 ? { clipPath: "polygon(12% 0, 88% 0, 100% 6%, 100% 86%, 70% 100%, 30% 100%, 0 86%, 0 6%)" } : {}),
  };
}

function ObjectInstructions({ objects }: { objects: ServingObject[] }) {
  return <ol>{objects.map((item) => <li key={item.id}><strong>{item.label} · {quantity(item)}{item.panSize ? ` · ${item.panSize} pan` : ""}</strong><p>{item.description}</p>{item.contents.length ? <p>Contents: {item.contents.join("; ")}</p> : null}{item.children?.length ? <ObjectInstructions objects={item.children} /> : null}</li>)}</ol>;
}
