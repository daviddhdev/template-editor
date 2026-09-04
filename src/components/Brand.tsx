import { useId, type SVGProps } from 'react'

export type BrandMarkProps = Omit<SVGProps<SVGSVGElement>, 'title'> & {
  /** Accessible name for icon-only use. Omit when a visible wordmark is next to the mark. */
  label?: string
  size?: number
}

/**
 * Talos' document mark: structured data lines converge into a sheet, with a
 * small bronze folded-page detail. Keep this geometry simple so it survives at
 * favicon size as well as in the application header.
 */
export function BrandMark({ label, size = 40, className, ...props }: BrandMarkProps) {
  const id = useId()
  const titleId = label ? `talos-mark-title-${id}` : undefined
  return (
    <svg
      {...props}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      role={label ? 'img' : undefined}
      aria-hidden={label ? undefined : true}
      aria-labelledby={titleId}
      focusable="false"
    >
      {label ? <title id={titleId}>{label}</title> : null}
      <rect x="3" y="3" width="58" height="58" rx="14" fill="#0F5C5E" />
      <path
        d="M11 20h8l7 4M11 28h10l5 4M11 36h8l7-4M11 44h10l5-4"
        stroke="#D8A85D"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M25 13h17l9 9v29H25V13Z" fill="#FFFDF9" />
      <path d="M42 13v9h9l-9-9Z" fill="#B85C38" />
      <path d="M29 26h17v5h-6v14h-5V31h-6v-5Z" fill="#0F5C5E" />
    </svg>
  )
}

export type BrandLockupProps = {
  variant?: 'compact' | 'full'
  className?: string
  markClassName?: string
}

/** Shared Talos identity for headers and the login screen. */
export function BrandLockup({ variant = 'compact', className = '', markClassName = '' }: BrandLockupProps) {
  const full = variant === 'full'
  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      <BrandMark size={full ? 52 : 32} className={markClassName} />
      <span className="flex min-w-0 flex-col text-left">
        <span className={`${full ? 'text-[30px] leading-none tracking-[-1px]' : 'text-lg leading-none tracking-[-0.4px]'} font-bold text-ink`}>
          Talos
        </span>
        {full ? <span className="mt-1.5 text-sm font-medium text-ink-muted">Automatización documental</span> : null}
      </span>
    </div>
  )
}
