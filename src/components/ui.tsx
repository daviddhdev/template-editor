import { useEffect, useRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { AlertCircle, Info, Loader2 } from 'lucide-react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-active disabled:bg-primary/40',
  secondary:
    'bg-surface text-ink-secondary border border-hairline shadow-e1 hover:bg-canvas-soft disabled:opacity-50',
  ghost: 'bg-transparent text-ink-secondary hover:bg-black/5 disabled:opacity-40',
  danger: 'bg-surface text-red-600 border border-red-200 hover:bg-red-50',
}

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-hairline bg-surface p-6 shadow-e1 ${className}`}>{children}</div>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-secondary">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-muted">{hint}</span> : null}
    </label>
  )
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-input-border bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-primary focus:ring-2 focus:ring-primary/10 ${props.className ?? ''}`}
    />
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-muted">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </span>
  )
}

export function ErrorNote({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
      <div>
        <p className="font-medium text-red-800">{title}</p>
        {hint ? <p className="mt-0.5 text-red-600">{hint}</p> : null}
      </div>
    </div>
  )
}

export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-ink-secondary">
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
      <div>{children}</div>
    </div>
  )
}

export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'muted'; children: ReactNode }) {
  const tones = {
    ok: 'bg-accent-green/10 text-accent-green',
    warn: 'bg-accent-orange/10 text-accent-orange',
    muted: 'border border-hairline bg-surface text-ink-faint',
  }
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
}

/**
 * Shared dialog behaviour: close on Escape and return focus to whatever had
 * it before the dialog opened (WCAG 2.1.2 / 2.4.3). Call from any component
 * rendered as a modal/popover.
 */
export function useDialogChrome(onClose: () => void) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [])
}

/**
 * One-at-a-time transient notice. The aria-live region stays mounted so
 * screen readers announce new notices; visual auto-dismiss after 4 s.
 */
export function Toast({
  text,
  token,
  onDismiss,
}: {
  text: string | null
  token: number
  onDismiss: () => void
}) {
  useEffect(() => {
    if (!text) return
    const t = setTimeout(onDismiss, 4000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, token])

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 left-1/2 z-[70] -translate-x-1/2"
    >
      {text ? (
        <div className="rounded-full bg-ink px-4 py-2 text-sm text-white shadow-e2">
          {text}
        </div>
      ) : null}
    </div>
  )
}

/** Small confirmation modal for destructive actions (reset, disconnect…). */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string
  body?: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  useDialogChrome(onCancel)
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-xl border border-hairline bg-surface p-5 shadow-e2"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-ink">{title}</p>
        {body ? <p className="mt-1.5 text-sm text-ink-muted">{body}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          {/* Focus lands on the SAFE option by default. */}
          <Button variant="secondary" onClick={onCancel} autoFocus>
            Cancelar
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
