export type AdminAssetOverlay = {
  id: string;
  kind: "highlight" | "cover";
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  opacity: number;
  text: string;
  textColor: string;
  fontSize: number;
};

export type AdminState = {
  archivedAssetKeys: string[];
  archivedEventIds: number[];
  overlaysByAsset: Record<string, AdminAssetOverlay[]>;
};

export function emptyAdminState(): AdminState {
  return {
    archivedAssetKeys: [],
    archivedEventIds: [],
    overlaysByAsset: {},
  };
}
