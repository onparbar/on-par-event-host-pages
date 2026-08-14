"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

const PORTAL_NAVIGATION = [
  { href: "/", label: "Home" },
  { href: "/floor-plans", label: "Floor Plans" },
  { href: "/entertainment-schedules", label: "Entertainment" },
  { href: "/itineraries", label: "Itineraries" },
  { href: "/checklists", label: "Checklists" },
  { href: "/event-host-addons", label: "Add-Ons" },
  { href: "/kitchen", label: "Kitchen" },
  { href: "/admin", label: "Admin" },
] as const;

type PortalHeaderProps = {
  actions?: ReactNode;
  allowFullscreen?: boolean;
  blocked?: boolean;
  onLock?: () => void;
  sectionSubtitle: string;
  sectionTitle: string;
};

function isActiveRoute(pathname: string, href: string) {
  return href === "/"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

function PortalNavigation({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={mobile ? "Mobile portal navigation" : "Portal navigation"}
      className={mobile ? "portal-mobile-navigation" : "portal-navigation"}
    >
      {PORTAL_NAVIGATION.map((item) => {
        const active = isActiveRoute(pathname, item.href);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={active ? "is-active" : undefined}
            href={item.href}
            key={item.href}
            onClick={onNavigate}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function PortalHeader({
  actions,
  allowFullscreen = false,
  blocked = false,
  onLock,
  sectionSubtitle,
  sectionTitle,
}: PortalHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    function updateFullscreenState() {
      setFullscreen(Boolean(document.fullscreenElement));
    }

    document.addEventListener("fullscreenchange", updateFullscreenState);
    return () =>
      document.removeEventListener(
        "fullscreenchange",
        updateFullscreenState,
      );
  }, []);

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await document.documentElement.requestFullscreen();
  }

  return (
    <header
      aria-hidden={blocked ? true : undefined}
      className="portal-header"
      inert={blocked ? true : undefined}
    >
      <Link className="portal-brand" href="/">
        <Image
          alt="On Par Entertainment"
          className="portal-brand-logo"
          height={83}
          priority
          src="/brand/on-par-logo-white-transparent.png"
          width={162}
        />
        <span className="portal-brand-copy">
          <strong>{sectionTitle}</strong>
          <span>{sectionSubtitle}</span>
        </span>
      </Link>

      <PortalNavigation />

      <div className="portal-header-actions">
        {actions}
        {allowFullscreen ? (
          <button
            className="portal-header-button portal-fullscreen-button"
            onClick={() => void toggleFullscreen()}
            type="button"
          >
            {fullscreen ? "Exit full screen" : "Full screen"}
          </button>
        ) : null}
        {onLock ? (
          <button
            className="portal-header-button"
            onClick={onLock}
            type="button"
          >
            Lock
          </button>
        ) : null}
        <button
          aria-expanded={menuOpen}
          aria-label="Toggle portal navigation"
          className="portal-menu-button"
          onClick={() => setMenuOpen((current) => !current)}
          type="button"
        >
          <span aria-hidden="true">{menuOpen ? "×" : "☰"}</span>
          <span>Menu</span>
        </button>
      </div>

      {menuOpen ? (
        <div className="portal-mobile-panel">
          <PortalNavigation
            mobile
            onNavigate={() => setMenuOpen(false)}
          />
        </div>
      ) : null}
    </header>
  );
}

export function PortalFrame({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`portal-shell${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}

export function PortalZoomControls({
  label,
  maximum,
  minimum,
  onChange,
  resetValue,
  step,
  value,
}: {
  label: string;
  maximum: number;
  minimum: number;
  onChange: (value: number) => void;
  resetValue: number;
  step: number;
  value: number;
}) {
  return (
    <div aria-label={label} className="portal-zoom-controls" role="group">
      <button
        aria-label={`${label}: zoom out`}
        className="portal-header-button"
        disabled={value <= minimum}
        onClick={() => onChange(Math.max(minimum, value - step))}
        type="button"
      >
        −
      </button>
      <button
        aria-label={`Reset ${label.toLowerCase()} from ${value}% to ${resetValue}%`}
        className="portal-header-button portal-zoom-value"
        disabled={value === resetValue}
        onClick={() => onChange(resetValue)}
        type="button"
      >
        {value}%
      </button>
      <button
        aria-label={`${label}: zoom in`}
        className="portal-header-button"
        disabled={value >= maximum}
        onClick={() => onChange(Math.min(maximum, value + step))}
        type="button"
      >
        +
      </button>
    </div>
  );
}

export function PortalShell({
  actions,
  allowFullscreen,
  blocked,
  children,
  className = "",
  mainClassName = "",
  onLock,
  sectionSubtitle,
  sectionTitle,
}: PortalHeaderProps & {
  children: ReactNode;
  className?: string;
  mainClassName?: string;
}) {
  return (
    <PortalFrame className={className}>
      <PortalHeader
        actions={actions}
        allowFullscreen={allowFullscreen}
        blocked={blocked}
        onLock={onLock}
        sectionSubtitle={sectionSubtitle}
        sectionTitle={sectionTitle}
      />
      <main
        className={`portal-main${mainClassName ? ` ${mainClassName}` : ""}`}
      >
        {children}
      </main>
    </PortalFrame>
  );
}

export function PortalPageHeader({
  aside,
  description,
  eyebrow,
  title,
}: {
  aside?: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <section className="portal-page-header">
      <div>
        <span className="portal-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {aside ? <div className="portal-page-header-aside">{aside}</div> : null}
    </section>
  );
}

export function PortalCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`portal-card${className ? ` ${className}` : ""}`}>
      {children}
    </section>
  );
}

export function PortalStatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <span className={`portal-status-badge is-${tone}`}>{children}</span>
  );
}

export function PortalState({
  description,
  icon,
  title,
}: {
  description: string;
  icon: string;
  title: string;
}) {
  return (
    <section className="portal-state-card">
      <span aria-hidden="true" className="portal-state-icon">
        {icon}
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  );
}

export function PortalAccessGate({
  description,
  productLabel,
  submitLabel,
  title,
}: {
  description: string;
  productLabel: string;
  submitLabel: string;
  title: string;
}) {
  const [pin, setPin] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "error">(
    "idle",
  );
  const [error, setError] = useState("");
  const inputId = `portal-pin-${productLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    setError("");

    try {
      const response = await fetch("/api/admin-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error || "Unable to unlock Event Host.");
      }
      window.location.reload();
    } catch (submitError) {
      setState("error");
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Unable to unlock Event Host.",
      );
    }
  }

  return (
    <main className="portal-auth-shell">
      <section
        aria-labelledby={`${inputId}-title`}
        className="portal-auth-card"
      >
        <div className="portal-auth-brand">
          <Image
            alt="On Par Entertainment"
            className="portal-auth-logo"
            height={154}
            priority
            src="/brand/on-par-logo-white-transparent.png"
            width={300}
          />
          <p>{productLabel}</p>
        </div>
        <div className="portal-auth-form-wrap">
          <span className="portal-eyebrow">Protected operations portal</span>
          <h1 id={`${inputId}-title`}>{title}</h1>
          <p>{description}</p>
          <form className="portal-auth-form" onSubmit={handleSubmit}>
            <label htmlFor={inputId}>Event Host PIN</label>
            <input
              aria-describedby={error ? `${inputId}-error` : undefined}
              autoComplete="one-time-code"
              autoFocus
              id={inputId}
              inputMode="numeric"
              maxLength={4}
              onChange={(event) =>
                setPin(
                  event.target.value.replace(/\D/g, "").slice(0, 4),
                )
              }
              pattern="[0-9]{4}"
              type="password"
              value={pin}
            />
            <button
              disabled={pin.length !== 4 || state === "submitting"}
              type="submit"
            >
              {state === "submitting" ? "Checking…" : submitLabel}
            </button>
            {error ? (
              <p
                className="portal-form-error"
                id={`${inputId}-error`}
                role="alert"
              >
                {error}
              </p>
            ) : null}
          </form>
          <Link className="portal-back-link" href="/">
            Back to Event Host
          </Link>
        </div>
      </section>
    </main>
  );
}
