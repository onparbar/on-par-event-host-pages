import type { AdminAssetOverlay } from "@/lib/admin-types";

type AssetImageWithOverlaysProps = {
  image: string;
  alt: string;
  overlays?: AdminAssetOverlay[];
};

export default function AssetImageWithOverlays({ image, alt, overlays = [] }: AssetImageWithOverlaysProps) {
  if (!overlays.length) {
    return <img className="asset-image" src={image} alt={alt} />;
  }

  return (
    <div className="asset-image-stage">
      <img className="asset-image" src={image} alt={alt} />
      {overlays.map((overlay) => (
        <div
          className={`asset-display-overlay overlay-${overlay.kind}`}
          key={overlay.id}
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
        >
          {overlay.text ? <span className="asset-overlay-text">{overlay.text}</span> : null}
        </div>
      ))}
    </div>
  );
}
