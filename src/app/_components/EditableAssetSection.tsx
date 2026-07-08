"use client";

import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AdminAssetOverlay } from "@/lib/admin-types";
import type { DateAsset } from "@/lib/events";

type AssetEditorKind = "highlight" | "cover";
type AssetEditorTool = "select" | AssetEditorKind;
type AssetOverlay = AdminAssetOverlay;

type DragInteraction =
  | {
      mode: "create";
      kind: AssetEditorKind;
      startX: number;
      startY: number;
      currentX: number;
      currentY: number;
    }
  | {
      mode: "move";
      overlayId: string;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    }
  | {
      mode: "resize";
      overlayId: string;
      startX: number;
      startY: number;
      originWidth: number;
      originHeight: number;
    };

type EditableAssetSectionProps = {
  asset: DateAsset;
  title: string;
  subtitle?: string;
  overlays?: AssetOverlay[];
  onOverlaysChange?: (overlays: AssetOverlay[]) => void;
  persistenceMode?: "local" | "remote";
  archiveAction?: {
    label: string;
    onClick: () => void;
  };
  archived?: boolean;
  helperNote?: ReactNode;
};

const MIN_OVERLAY_SIZE = 1;

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `overlay-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function defaultOverlay(kind: AssetEditorKind, rect?: Pick<AssetOverlay, "x" | "y" | "width" | "height">): AssetOverlay {
  return {
    id: createId(),
    kind,
    x: rect?.x ?? 16,
    y: rect?.y ?? 16,
    width: rect?.width ?? 12,
    height: rect?.height ?? 10,
    fill: kind === "cover" ? "#f7f8f4" : "#f59e0b",
    opacity: kind === "cover" ? 0.96 : 0.38,
    text: "",
    textColor: "#202326",
    fontSize: 22,
  };
}

function normalizeRect(startX: number, startY: number, endX: number, endY: number) {
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  const right = Math.max(startX, endX);
  const bottom = Math.max(startY, endY);

  return {
    x: clamp(left, 0, 100),
    y: clamp(top, 0, 100),
    width: clamp(right - left, 0, 100),
    height: clamp(bottom - top, 0, 100),
  };
}

function pointFromPointer(event: PointerEvent | ReactPointerEvent, element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
    y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100),
  };
}

function updateOverlay(overlays: AssetOverlay[], overlayId: string, updater: (overlay: AssetOverlay) => AssetOverlay) {
  return overlays.map((overlay) => (overlay.id === overlayId ? updater(overlay) : overlay));
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (context.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function moveOverlay(overlays: AssetOverlay[], overlayId: string, direction: "forward" | "backward") {
  const index = overlays.findIndex((overlay) => overlay.id === overlayId);
  if (index < 0) {
    return overlays;
  }

  if (direction === "forward" && index < overlays.length - 1) {
    const next = [...overlays];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    return next;
  }

  if (direction === "backward" && index > 0) {
    const next = [...overlays];
    [next[index], next[index - 1]] = [next[index - 1], next[index]];
    return next;
  }

  return overlays;
}

function serializeOverlays(overlays: AssetOverlay[]) {
  return JSON.stringify(overlays);
}

export default function EditableAssetSection({
  asset,
  title,
  subtitle,
  overlays: controlledOverlays,
  onOverlaysChange,
  persistenceMode = "local",
  archiveAction,
  archived = false,
  helperNote,
}: EditableAssetSectionProps) {
  const [tool, setTool] = useState<AssetEditorTool>("select");
  const [overlays, setOverlays] = useState<AssetOverlay[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [interaction, setInteraction] = useState<DragInteraction | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const lastSyncedOverlaysRef = useRef("");
  const storageKey = useMemo(() => `on-par-asset-overlays:v1:${asset.image}`, [asset.image]);
  const selectedOverlay = overlays.find((overlay) => overlay.id === selectedId) ?? null;
  const saveNote =
    persistenceMode === "remote"
      ? "Edits here publish to the admin-backed event host. Use Cover to hide baked-in marks, then add fresh highlights on top."
      : "Edits save in this browser. Use Cover to hide baked-in marks, then add fresh highlights on top.";

  useEffect(() => {
    if (persistenceMode === "remote") {
      const nextOverlays = controlledOverlays ?? [];
      lastSyncedOverlaysRef.current = serializeOverlays(nextOverlays);
      setOverlays(nextOverlays);
      setHasLoaded(true);
      return;
    }

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as AssetOverlay[];
        if (Array.isArray(parsed)) {
          setOverlays(parsed);
        }
      }
    } catch {
      setOverlays([]);
    } finally {
      setHasLoaded(true);
    }
  }, [controlledOverlays, persistenceMode, storageKey]);

  useEffect(() => {
    if (!hasLoaded) {
      return;
    }

    if (persistenceMode === "remote") {
      const signature = serializeOverlays(overlays);
      if (signature === lastSyncedOverlaysRef.current) {
        return;
      }
      lastSyncedOverlaysRef.current = signature;
      onOverlaysChange?.(overlays);
      return;
    }

    onOverlaysChange?.(overlays);

    if (!overlays.length) {
      window.localStorage.removeItem(storageKey);
      return;
    }

    window.localStorage.setItem(storageKey, JSON.stringify(overlays));
  }, [hasLoaded, onOverlaysChange, overlays, persistenceMode, storageKey]);

  useEffect(() => {
    function handleDeleteKey(event: KeyboardEvent) {
      if (!selectedId || (event.key !== "Backspace" && event.key !== "Delete")) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        return;
      }

      setOverlays((current) => current.filter((overlay) => overlay.id !== selectedId));
      setSelectedId(null);
    }

    window.addEventListener("keydown", handleDeleteKey);
    return () => window.removeEventListener("keydown", handleDeleteKey);
  }, [selectedId]);

  useEffect(() => {
    if (!interaction || !stageRef.current) {
      return;
    }

    const currentInteraction = interaction;
    const stage = stageRef.current;

    function handlePointerMove(event: PointerEvent) {
      event.preventDefault();
      const point = pointFromPointer(event, stage);

      if (currentInteraction.mode === "create") {
        setInteraction((current) =>
          current && current.mode === "create"
            ? {
                ...current,
                currentX: point.x,
                currentY: point.y,
              }
            : current,
        );
        return;
      }

      if (currentInteraction.mode === "move") {
        const deltaX = point.x - currentInteraction.startX;
        const deltaY = point.y - currentInteraction.startY;
        setOverlays((current) =>
          updateOverlay(current, currentInteraction.overlayId, (overlay) => ({
            ...overlay,
            x: clamp(currentInteraction.originX + deltaX, 0, 100 - overlay.width),
            y: clamp(currentInteraction.originY + deltaY, 0, 100 - overlay.height),
          })),
        );
        return;
      }

      const deltaX = point.x - currentInteraction.startX;
      const deltaY = point.y - currentInteraction.startY;
      setOverlays((current) =>
        updateOverlay(current, currentInteraction.overlayId, (overlay) => ({
          ...overlay,
          width: clamp(currentInteraction.originWidth + deltaX, MIN_OVERLAY_SIZE, 100 - overlay.x),
          height: clamp(currentInteraction.originHeight + deltaY, MIN_OVERLAY_SIZE, 100 - overlay.y),
        })),
      );
    }

    function handlePointerUp() {
      if (currentInteraction.mode === "create") {
        const rect = normalizeRect(currentInteraction.startX, currentInteraction.startY, currentInteraction.currentX, currentInteraction.currentY);
        if (rect.width >= MIN_OVERLAY_SIZE && rect.height >= MIN_OVERLAY_SIZE) {
          const overlay = defaultOverlay(currentInteraction.kind, rect);
          setOverlays((current) => [...current, overlay]);
          setSelectedId(overlay.id);
          setTool("select");
        }
      }

      setInteraction(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [interaction]);

  const draftOverlay = interaction?.mode === "create"
    ? defaultOverlay(interaction.kind, normalizeRect(interaction.startX, interaction.startY, interaction.currentX, interaction.currentY))
    : null;

  function handleStagePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!stageRef.current) {
      return;
    }

    const point = pointFromPointer(event, stageRef.current);

    if (tool === "select") {
      setSelectedId(null);
      return;
    }

    setInteraction({
      mode: "create",
      kind: tool,
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    });
  }

  function handleOverlayPointerDown(event: ReactPointerEvent<HTMLElement>, overlayId: string, mode: "move" | "resize") {
    event.stopPropagation();
    if (!stageRef.current) {
      return;
    }

    const overlay = overlays.find((item) => item.id === overlayId);
    if (!overlay) {
      return;
    }

    const point = pointFromPointer(event, stageRef.current);
    setSelectedId(overlayId);

    if (mode === "move") {
      setInteraction({
        mode,
        overlayId,
        startX: point.x,
        startY: point.y,
        originX: overlay.x,
        originY: overlay.y,
      });
      return;
    }

    setInteraction({
      mode,
      overlayId,
      startX: point.x,
      startY: point.y,
      originWidth: overlay.width,
      originHeight: overlay.height,
    });
  }

  function patchSelected(updater: (overlay: AssetOverlay) => AssetOverlay) {
    if (!selectedId) {
      return;
    }

    setOverlays((current) => updateOverlay(current, selectedId, updater));
  }

  async function downloadFlattenedAsset() {
    if (!imageRef.current) {
      return;
    }

    const image = imageRef.current;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const overlay of overlays) {
      const x = (overlay.x / 100) * canvas.width;
      const y = (overlay.y / 100) * canvas.height;
      const width = (overlay.width / 100) * canvas.width;
      const height = (overlay.height / 100) * canvas.height;

      context.save();
      context.globalAlpha = overlay.opacity;
      context.fillStyle = overlay.fill;
      context.fillRect(x, y, width, height);
      context.globalAlpha = 1;
      context.strokeStyle = overlay.fill;
      context.lineWidth = Math.max(2, canvas.width / 960);
      context.strokeRect(x, y, width, height);

      if (overlay.text.trim()) {
        context.fillStyle = overlay.textColor;
        context.font = `700 ${overlay.fontSize}px Arial`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        const lines = wrapCanvasText(context, overlay.text.trim(), Math.max(width - 16, 40));
        const lineHeight = overlay.fontSize * 1.05;
        const totalHeight = lines.length * lineHeight;
        lines.forEach((line, index) => {
          context.fillText(line, x + width / 2, y + height / 2 - totalHeight / 2 + lineHeight * (index + 0.5));
        });
      }

      context.restore();
    }

    const link = document.createElement("a");
    link.download = `${asset.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-edited.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <section className="asset-section editable-asset-section">
      <div className="editable-asset-heading">
        <div>
          <h3>{title}</h3>
          {subtitle ? <p className="meta">{subtitle}</p> : null}
        </div>
        <p className="meta editable-asset-note">{saveNote}</p>
      </div>

      <div className="event-row">
        {asset.events.map((event) => (
          <span className="event-chip" key={event}>
            {event}
          </span>
        ))}
      </div>

      <div className="asset-editor-toolbar" role="toolbar" aria-label={`Editor controls for ${asset.label}`}>
        <button className={`editor-tool${tool === "select" ? " active" : ""}`} onClick={() => setTool("select")} type="button">
          Select
        </button>
        <button className={`editor-tool${tool === "highlight" ? " active" : ""}`} onClick={() => setTool("highlight")} type="button">
          Add Highlight
        </button>
        <button className={`editor-tool${tool === "cover" ? " active" : ""}`} onClick={() => setTool("cover")} type="button">
          Add Cover
        </button>
        <button className="editor-tool" onClick={() => void downloadFlattenedAsset()} type="button">
          Download PNG
        </button>
        <button
          className="editor-tool danger"
          onClick={() => {
            if (window.confirm(`Clear all saved edits for ${asset.label}?`)) {
              setOverlays([]);
              setSelectedId(null);
              setTool("select");
            }
          }}
          type="button"
        >
          Reset Edits
        </button>
        {archiveAction ? (
          <button className={`editor-tool${archived ? " danger" : ""}`} onClick={archiveAction.onClick} type="button">
            {archiveAction.label}
          </button>
        ) : null}
        <span className="editor-status">{overlays.length} saved edit{overlays.length === 1 ? "" : "s"}</span>
      </div>

      <div className="asset-editor-layout">
        <div className="asset-editor-stage-card">
          <div
            className={`asset-editor-stage tool-${tool}`}
            onPointerDown={handleStagePointerDown}
            ref={stageRef}
            role="presentation"
          >
            <img className="asset-image asset-editor-image" ref={imageRef} src={asset.image} alt={`${title} for ${asset.label}`} />

            {overlays.map((overlay) => (
              <button
                aria-label={`Overlay ${overlay.text || overlay.kind}`}
                className={`asset-overlay overlay-${overlay.kind}${selectedId === overlay.id ? " selected" : ""}`}
                key={overlay.id}
                onPointerDown={(event) => handleOverlayPointerDown(event, overlay.id, "move")}
                style={{
                  left: `${overlay.x}%`,
                  top: `${overlay.y}%`,
                  width: `${overlay.width}%`,
                  height: `${overlay.height}%`,
                  backgroundColor: overlay.fill,
                  borderColor: overlay.fill,
                  opacity: overlay.opacity,
                  color: overlay.textColor,
                  fontSize: `${overlay.fontSize}px`,
                }}
                type="button"
              >
                {overlay.text ? <span className="asset-overlay-text">{overlay.text}</span> : null}
                {selectedId === overlay.id ? (
                  <span
                    className="asset-overlay-handle"
                    onPointerDown={(event) => handleOverlayPointerDown(event, overlay.id, "resize")}
                  />
                ) : null}
              </button>
            ))}

            {draftOverlay && draftOverlay.width >= MIN_OVERLAY_SIZE && draftOverlay.height >= MIN_OVERLAY_SIZE ? (
              <div
                className={`asset-overlay overlay-${draftOverlay.kind} overlay-draft`}
                style={{
                  left: `${draftOverlay.x}%`,
                  top: `${draftOverlay.y}%`,
                  width: `${draftOverlay.width}%`,
                  height: `${draftOverlay.height}%`,
                  backgroundColor: draftOverlay.fill,
                  opacity: draftOverlay.opacity,
                }}
              />
            ) : null}
          </div>
        </div>

        <aside className="asset-editor-panel">
          <div className="editor-panel-card">
            <span className="eyebrow">Editing</span>
            <strong>{asset.label}</strong>
            <p className="meta">
              Current tool: <strong>{tool}</strong>
            </p>
            {archived ? <p className="admin-archived-note">This date is currently removed from the public event host.</p> : null}
          </div>

          {selectedOverlay ? (
            <div className="editor-panel-card editor-form-card">
              <div className="editor-form-row">
                <label className="editor-field">
                  <span>Style</span>
                  <select
                    onChange={(event) =>
                      patchSelected((overlay) => ({
                        ...overlay,
                        kind: event.target.value as AssetEditorKind,
                        fill: event.target.value === "cover" ? "#f7f8f4" : overlay.fill,
                        opacity: event.target.value === "cover" ? Math.max(overlay.opacity, 0.85) : Math.min(overlay.opacity, 0.45),
                      }))
                    }
                    value={selectedOverlay.kind}
                  >
                    <option value="highlight">Highlight</option>
                    <option value="cover">Cover</option>
                  </select>
                </label>
                <label className="editor-field">
                  <span>Fill</span>
                  <input onChange={(event) => patchSelected((overlay) => ({ ...overlay, fill: event.target.value }))} type="color" value={selectedOverlay.fill} />
                </label>
              </div>

              <div className="editor-form-row">
                <label className="editor-field">
                  <span>Opacity</span>
                  <input
                    max={100}
                    min={10}
                    onChange={(event) => patchSelected((overlay) => ({ ...overlay, opacity: Number(event.target.value) / 100 }))}
                    type="range"
                    value={Math.round(selectedOverlay.opacity * 100)}
                  />
                </label>
                <label className="editor-field">
                  <span>Text Color</span>
                  <input onChange={(event) => patchSelected((overlay) => ({ ...overlay, textColor: event.target.value }))} type="color" value={selectedOverlay.textColor} />
                </label>
              </div>

              <label className="editor-field">
                <span>Label</span>
                <input
                  onChange={(event) => patchSelected((overlay) => ({ ...overlay, text: event.target.value }))}
                  placeholder="VIP 1, 2-4 PM, FOOD, etc."
                  type="text"
                  value={selectedOverlay.text}
                />
              </label>

              <div className="editor-form-row editor-form-row-compact">
                <label className="editor-field">
                  <span>X</span>
                  <input
                    max={100}
                    min={0}
                    onChange={(event) => patchSelected((overlay) => ({ ...overlay, x: clamp(Number(event.target.value), 0, 100 - overlay.width) }))}
                    step={0.1}
                    type="number"
                    value={selectedOverlay.x}
                  />
                </label>
                <label className="editor-field">
                  <span>Y</span>
                  <input
                    max={100}
                    min={0}
                    onChange={(event) => patchSelected((overlay) => ({ ...overlay, y: clamp(Number(event.target.value), 0, 100 - overlay.height) }))}
                    step={0.1}
                    type="number"
                    value={selectedOverlay.y}
                  />
                </label>
                <label className="editor-field">
                  <span>W</span>
                  <input
                    max={100}
                    min={MIN_OVERLAY_SIZE}
                    onChange={(event) =>
                      patchSelected((overlay) => ({
                        ...overlay,
                        width: clamp(Number(event.target.value), MIN_OVERLAY_SIZE, 100 - overlay.x),
                      }))
                    }
                    step={0.1}
                    type="number"
                    value={selectedOverlay.width}
                  />
                </label>
                <label className="editor-field">
                  <span>H</span>
                  <input
                    max={100}
                    min={MIN_OVERLAY_SIZE}
                    onChange={(event) =>
                      patchSelected((overlay) => ({
                        ...overlay,
                        height: clamp(Number(event.target.value), MIN_OVERLAY_SIZE, 100 - overlay.y),
                      }))
                    }
                    step={0.1}
                    type="number"
                    value={selectedOverlay.height}
                  />
                </label>
              </div>

              <label className="editor-field">
                <span>Font Size</span>
                <input
                  max={72}
                  min={12}
                  onChange={(event) => patchSelected((overlay) => ({ ...overlay, fontSize: Number(event.target.value) }))}
                  step={1}
                  type="range"
                  value={selectedOverlay.fontSize}
                />
              </label>

              <div className="editor-action-row">
                <button className="editor-tool" onClick={() => setOverlays((current) => moveOverlay(current, selectedOverlay.id, "forward"))} type="button">
                  Bring Forward
                </button>
                <button className="editor-tool" onClick={() => setOverlays((current) => moveOverlay(current, selectedOverlay.id, "backward"))} type="button">
                  Send Backward
                </button>
                <button
                  className="editor-tool"
                  onClick={() => {
                    const clone = { ...selectedOverlay, id: createId(), x: clamp(selectedOverlay.x + 1.5, 0, 100 - selectedOverlay.width), y: clamp(selectedOverlay.y + 1.5, 0, 100 - selectedOverlay.height) };
                    setOverlays((current) => [...current, clone]);
                    setSelectedId(clone.id);
                  }}
                  type="button"
                >
                  Duplicate
                </button>
                <button
                  className="editor-tool danger"
                  onClick={() => {
                    setOverlays((current) => current.filter((overlay) => overlay.id !== selectedOverlay.id));
                    setSelectedId(null);
                  }}
                  type="button"
                >
                  Delete Selected Highlight
                </button>
              </div>
            </div>
          ) : (
            <div className="editor-panel-card editor-help-card">
              <span className="eyebrow">How To Edit</span>
              <ul className="editor-help-list">
                <li>Select `Add Highlight` or `Add Cover`, then drag on the image.</li>
                <li>Click any saved box to move it. Drag the corner handle to resize it.</li>
                <li>Add labels like `VIP 2`, `F`, or `2-4 PM` from the inspector.</li>
                <li>`Download PNG` exports the image with your current browser edits flattened in.</li>
                <li>Press `Delete` or `Backspace` while a highlight is selected to remove it quickly.</li>
              </ul>
            </div>
          )}

          <div className="editor-panel-card">
            <span className="eyebrow">Saved Highlights</span>
            {overlays.length ? (
              <div className="saved-overlay-list">
                {overlays.map((overlay, index) => (
                  <div className="saved-overlay-row" key={overlay.id}>
                    <button
                      className={`saved-overlay-select${selectedId === overlay.id ? " active" : ""}`}
                      onClick={() => setSelectedId(overlay.id)}
                      type="button"
                    >
                      {overlay.text || `${overlay.kind === "cover" ? "Cover" : "Highlight"} ${index + 1}`}
                    </button>
                    <button
                      className="saved-overlay-delete"
                      onClick={() => {
                        setOverlays((current) => current.filter((item) => item.id !== overlay.id));
                        if (selectedId === overlay.id) {
                          setSelectedId(null);
                        }
                      }}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="meta">No saved highlights on this asset yet.</p>
            )}
            {helperNote ? <div className="admin-helper-note">{helperNote}</div> : null}
          </div>
        </aside>
      </div>
    </section>
  );
}
