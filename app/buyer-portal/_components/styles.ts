import type { CSSProperties } from 'react'

/**
 * Shared inline-style tokens for the buyer-portal UI (Req 18.5, 18.8, 18.10,
 * 18.11). Kept in a plain module (no JSX) so both server and client components
 * can reuse them. Mirrors the lightweight inline-style approach already used by
 * the dashboard and login pages.
 */

export const page: CSSProperties = { maxWidth: 760, margin: '40px auto', padding: 24 }

export const card: CSSProperties = {
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: 16,
    background: '#fff',
}

export const list: CSSProperties = { listStyle: 'none', padding: 0, display: 'grid', gap: 12 }

export const muted: CSSProperties = { color: '#6b7280', fontSize: 13 }

export const h1: CSSProperties = { fontSize: 24, fontWeight: 700 }

export const h2: CSSProperties = { fontSize: 16, fontWeight: 600, marginBottom: 12 }

export const primaryButton: CSSProperties = {
    padding: '10px 14px',
    fontSize: 15,
    fontWeight: 600,
    color: '#fff',
    background: '#2563eb',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
}

export const secondaryButton: CSSProperties = {
    padding: '8px 14px',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    background: '#fff',
    cursor: 'pointer',
    fontSize: 14,
}

export const input: CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    fontSize: 15,
    border: '1px solid #d1d5db',
    borderRadius: 8,
    marginBottom: 12,
    boxSizing: 'border-box',
}

export const errorText: CSSProperties = { color: '#b91c1c', marginTop: 8, fontSize: 14 }

export const successText: CSSProperties = { color: '#166534', marginTop: 8, fontSize: 14 }

export const badge: CSSProperties = {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    background: '#f3f4f6',
    color: '#374151',
}

/** Format a number as AED currency for buyer-facing amounts. */
export function formatAed(value: number | string): string {
    return `AED ${Number(value).toLocaleString('en-AE')}`
}
