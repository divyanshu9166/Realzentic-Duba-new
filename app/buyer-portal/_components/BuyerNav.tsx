import Link from 'next/link'
import { logoutBuyer } from '@/app/actions/buyer-portal'
import { secondaryButton } from './styles'

/**
 * Top navigation for the authenticated buyer-portal pages (Req 18.5). Renders
 * links to every buyer-facing area plus a logout action. The login page does
 * NOT use this nav, so it is added per-page rather than via a shared layout
 * that would also wrap the unauthenticated login route.
 */

const TABS: { href: string; label: string; key: string }[] = [
    { href: '/buyer-portal', label: 'Dashboard', key: 'dashboard' },
    { href: '/buyer-portal/payments', label: 'Payments', key: 'payments' },
    { href: '/buyer-portal/documents', label: 'Documents', key: 'documents' },
    { href: '/buyer-portal/updates', label: 'Updates', key: 'updates' },
    { href: '/buyer-portal/tickets', label: 'Support', key: 'tickets' },
    { href: '/buyer-portal/possession', label: 'Possession', key: 'possession' },
]

export function BuyerNav({ active, title, subtitle }: { active: string; title: string; subtitle?: string }) {
    async function handleLogout() {
        'use server'
        await logoutBuyer()
    }

    return (
        <header style={{ marginBottom: 24 }}>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
                }}
            >
                <div>
                    <h1 style={{ fontSize: 24, fontWeight: 700 }}>{title}</h1>
                    {subtitle ? <p style={{ color: '#6b7280', fontSize: 14 }}>{subtitle}</p> : null}
                </div>
                <form action={handleLogout}>
                    <button type="submit" style={secondaryButton}>
                        Log out
                    </button>
                </form>
            </div>
            <nav
                style={{
                    display: 'flex',
                    gap: 4,
                    flexWrap: 'wrap',
                    marginTop: 16,
                    borderBottom: '1px solid #e5e7eb',
                    paddingBottom: 8,
                }}
            >
                {TABS.map((tab) => (
                    <Link
                        key={tab.key}
                        href={tab.href}
                        style={{
                            padding: '6px 12px',
                            borderRadius: 8,
                            fontSize: 14,
                            textDecoration: 'none',
                            fontWeight: tab.key === active ? 600 : 400,
                            color: tab.key === active ? '#2563eb' : '#374151',
                            background: tab.key === active ? '#eff6ff' : 'transparent',
                        }}
                    >
                        {tab.label}
                    </Link>
                ))}
            </nav>
        </header>
    )
}
