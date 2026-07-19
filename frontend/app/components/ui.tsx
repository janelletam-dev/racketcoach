import Link from "next/link";
import type { ReactNode } from "react";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`rc-wordmark ${className}`}>RACKETCOACH</span>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`rc-card p-6 sm:p-7 ${className}`}>{children}</div>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="rc-label">{children}</div>;
}

export function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="rc-tile px-4 py-3">
      <div className="rc-label !text-[0.8rem]">{label}</div>
      <div className="rc-term text-3xl leading-none text-rc-ink mt-1">
        {value}
      </div>
      {sub ? <div className="text-xs text-rc-muted mt-1">{sub}</div> : null}
    </div>
  );
}

type ButtonVariant = "indigo" | "amber" | "ghost";

const variantClass: Record<ButtonVariant, string> = {
  indigo: "rc-btn",
  amber: "rc-btn rc-btn-amber",
  ghost: "rc-btn rc-btn-ghost",
};

export function PixelLink({
  href,
  children,
  variant = "indigo",
  prefetch,
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  prefetch?: boolean;
}) {
  return (
    <Link href={href} className={variantClass[variant]} prefetch={prefetch}>
      {children}
    </Link>
  );
}

/** Plain anchor (no prefetch) for endpoints that should not be pre-fetched. */
export function PixelAnchor({
  href,
  children,
  variant = "indigo",
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
}) {
  return (
    <a href={href} className={variantClass[variant]}>
      {children}
    </a>
  );
}

export function Badge({
  children,
  tone = "violet",
}: {
  children: ReactNode;
  tone?: "violet" | "amber" | "pink" | "muted";
}) {
  const tones: Record<string, string> = {
    violet: "bg-rc-purple text-white",
    amber: "bg-rc-amber text-[#3b2708]",
    pink: "bg-rc-magenta text-white",
    muted: "bg-rc-row text-rc-muted",
  };
  return (
    <span
      className={`rc-term inline-block px-2 py-0.5 rounded-md text-sm ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
