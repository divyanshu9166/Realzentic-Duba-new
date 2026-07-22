import Link from 'next/link'
import { prisma } from '@/lib/db'
import { requireBuyerAuth } from '@/lib/buyer-session'
import {
    getConstructionTimeline,
    listSupportTickets,
    getPossessionChecklist,
    getPaymentOptions,
} from '@/app/actions/buyer-portal'
import { BuyerNav } from './_components/BuyerNav'
import {
    card,
    list,
    muted,
    h2,
    badge,
    formatINR,
    page as pageStyle,
    primaryButton,
    errorText,
} from './_components/styles'
import type { CSSProperties } from 'react'

export const dynamic = 'force-dynamic'

/**
 * Buyer portal dashboard (Req 18.5, 18.8, 18.10, 18.11).
 *
 * A unified hub for the authenticated buyer — scoped throughout to the session's
 * `contactId` so one buyer can never see another's data (Req 18.6, 21.2). Renders:
 *
 *   • Bookings & payment tracker — milestones per booking with outstanding
 *     balance and (when enabled) a Pay Now button or manual bank/UPI details
 *     (Req 18.5, 18.11, A5).
 *   • Document downloads — documents attached to the buyer's contact or bookings,
 *     downloadable inline (Req 18.5).
 *   • Construction timeline — progress updates for the buyer's own projects,
 *     newest-first with milestone % bars (Req 18.8).
 *   • Support tickets — list of raised tickets plus a link to create new ones
 *     (Req 18.9).
 *   • Possession checklists — per-booking possession status summary with a link
 *     to the interactive sign-off view (Req 18.10).
 *
 * `requireBuyerAuth` redirects unauthenticated / expired requests to the login
 * page (Req 21.1, 18.7).
 */
export default async function BuyerPortalHome() {
    const { contactId } = await requireBuyerAuth()

    // ── Parallel data fetches (all scoped to contactId) ──────────────────────
    const [contact, bookings, documents, timelineRes, ticketsRes, paymentOptionsRes] =
        await Promise.all([
            prisma.contact.findUnique({
                where: { id: contactId },
                select: { name: true, phone: true },
            }),
            // Booking list — milestones for the payment tracker (Req 18.11).
            prisma.booking.findMany({
                where: { contactId },
                orderBy: { bookingDate: 'desc' },
                select: {
                    id: true,
                    bookingDate: true,
                    status: true,
                    agreementValue: true,
                    unit: {
                        select: {
                            unitNumber: true,
                            tower: { select: { name: true, project: { select: { name: true } } } },
                        },
                    },
                    milestones: {
                        orderBy: { dueDate: 'asc' },
                        select: {
                            id: true,
                            name: true,
                            dueDate: true,
                            amount: true,
                            paidAmount: true,
                            status: true,
                        },
                    },
                },
            }),
            // Documents for the buyer's contact + bookings (Req 18.5).
            prisma.booking
                .findMany({ where: { contactId }, select: { id: true } })
                .then((bs) => {
                    const bookingIds = bs.map((b) => b.id)
                    return prisma.document.findMany({
                        where: {
                            OR: [
                                { entityType: 'Contact', entityId: contactId },
                                ...(bookingIds.length > 0
                                    ? [{ entityType: 'Booking', entityId: { in: bookingIds } }]
                                    : []),
                            ],
                        },
                        orderBy: { createdAt: 'desc' },
                        take: 5,
                        select: {
                            id: true,
                            type: true,
                            fileUrl: true,
                            fileName: true,
                            fileSize: true,
                            status: true,
                            createdAt: true,
                        },
                    })
                }),
            // Construction timeline — scoped to buyer's projects (Req 18.8).
            getConstructionTimeline(),
            // Support tickets (Req 18.9).
            listSupportTickets(),
            // Payment options — mode + manual bank/UPI details (Req 18.11).
            getPaymentOptions(),
        ])

    const updates = timelineRes.success ? timelineRes.data.slice(0, 3) : []
    const tickets = ticketsRes.success ? ticketsRes.data.slice(0, 5) : []
    const paymentOptions = paymentOptionsRes.success ? paymentOptionsRes.data : null

    // Possession checklist summary — one fetch per booking.
    const possessionSummaries = await Promise.all(
        bookings.map(async (b) => {
            const res = await getPossessionChecklist(b.id)
            return {
                bookingId: b.id,
                label: b.unit?.unitNumber ? `Unit ${b.unit.unitNumber}` : `Booking #${b.id}`,
                checklist: res.success ? res.data : null,
            }
        })
    )


    return (
        <main style={pageStyle}>
            <BuyerNav
                active="dashboard"
                title={`Welcome${contact?.name ? `, ${contact.name}` : ''}`}
                subtitle="Your bookings and purchase details"
            />

            {/* ── Section 1: Bookings & Payment Tracker (Req 18.5, 18.11) ── */}
            <Section
                id="payments"
                title={`Bookings & Payments (${bookings.length})`}
                viewAllHref="/buyer-portal/payments"
            >
                {bookings.length === 0 ? (
                    <p style={muted}>No bookings yet.</p>
                ) : (
                    <ul style={list}>
                        {bookings.map((b) => {
                            const projectName = b.unit?.tower?.project?.name
                            const towerName = b.unit?.tower?.name
                            const totalDue = b.milestones.reduce(
                                (sum, m) =>
                                    sum + Math.max(0, Number(m.amount) - Number(m.paidAmount)),
                                0
                            )
                            return (
                                <li key={b.id} style={card}>
                                    <div style={rowBetween}>
                                        <div style={{ fontWeight: 600 }}>
                                            {b.unit?.unitNumber
                                                ? `Unit ${b.unit.unitNumber}`
                                                : `Booking #${b.id}`}
                                        </div>
                                        <span style={badge}>{b.status}</span>
                                    </div>
                                    {(projectName || towerName) && (
                                        <div style={{ ...muted, marginTop: 4 }}>
                                            {[projectName, towerName].filter(Boolean).join(' · ')}
                                        </div>
                                    )}
                                    <div style={{ ...muted, marginTop: 4 }}>
                                        Booked {new Date(b.bookingDate).toLocaleDateString()} ·{' '}
                                        Agreement {formatINR(b.agreementValue.toString())}
                                    </div>

                                    {/* Milestone table */}
                                    {b.milestones.length > 0 ? (
                                        <table
                                            style={{
                                                width: '100%',
                                                borderCollapse: 'collapse',
                                                marginTop: 12,
                                                fontSize: 13,
                                            }}
                                        >
                                            <thead>
                                                <tr style={{ textAlign: 'left', color: '#6b7280' }}>
                                                    <th style={cell}>Milestone</th>
                                                    <th style={cell}>Due</th>
                                                    <th style={cell}>Amount</th>
                                                    <th style={cell}>Paid</th>
                                                    <th style={cell}>Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {b.milestones.map((m) => (
                                                    <tr
                                                        key={m.id}
                                                        style={{ borderTop: '1px solid #f1f5f9' }}
                                                    >
                                                        <td style={cell}>{m.name}</td>
                                                        <td style={cell}>
                                                            {new Date(m.dueDate).toLocaleDateString()}
                                                        </td>
                                                        <td style={cell}>
                                                            {formatINR(m.amount.toString())}
                                                        </td>
                                                        <td style={cell}>
                                                            {formatINR(m.paidAmount.toString())}
                                                        </td>
                                                        <td style={cell}>
                                                            <span style={badge}>{m.status}</span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    ) : (
                                        <p style={{ ...muted, marginTop: 8 }}>
                                            No payment milestones scheduled yet.
                                        </p>
                                    )}

                                    <div style={{ ...rowBetween, marginTop: 12, flexWrap: 'wrap' }}>
                                        <div style={{ fontWeight: 600, fontSize: 14 }}>
                                            Outstanding: {formatINR(totalDue)}
                                        </div>
                                        {paymentOptions?.mode === 'online' && totalDue > 0 ? (
                                            <button type="button" style={primaryButton}>
                                                Pay Now
                                            </button>
                                        ) : null}
                                    </div>
                                </li>
                            )
                        })}
                    </ul>
                )}

                {/* Manual payment instructions (Req 18.11) */}
                {paymentOptions?.mode === 'manual' && paymentOptions.manual ? (
                    <div style={{ ...card, marginTop: 16 }}>
                        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>
                            How to pay
                        </h3>
                        <p style={{ ...muted, marginBottom: 10 }}>
                            Use the bank/UPI details below; your receipt will be recorded against
                            your milestones.
                        </p>
                        <dl
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'auto 1fr',
                                gap: '6px 16px',
                                margin: 0,
                                fontSize: 13,
                            }}
                        >
                            <Detail label="Bank" value={paymentOptions.manual.bankName} />
                            <Detail label="Account name" value={paymentOptions.manual.accountName} />
                            <Detail label="Account no." value={paymentOptions.manual.accountNumber} />
                            <Detail label="IFSC" value={paymentOptions.manual.ifsc} />
                            <Detail label="UPI ID" value={paymentOptions.manual.upiId} />
                        </dl>
                        {paymentOptions.manual.qrUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={paymentOptions.manual.qrUrl}
                                alt="Payment QR code"
                                style={{ marginTop: 12, maxWidth: 160, borderRadius: 8 }}
                            />
                        ) : null}
                    </div>
                ) : null}
            </Section>

            {/* ── Section 2: Document Downloads (Req 18.5) ── */}
            <Section
                id="documents"
                title="Documents"
                viewAllHref="/buyer-portal/documents"
            >
                {documents.length === 0 ? (
                    <p style={muted}>No documents are available yet.</p>
                ) : (
                    <ul style={list}>
                        {documents.map((doc) => (
                            <li
                                key={doc.id}
                                style={{
                                    ...card,
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    gap: 12,
                                    flexWrap: 'wrap',
                                }}
                            >
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                                        {doc.fileName}
                                    </div>
                                    <div
                                        style={{
                                            ...muted,
                                            marginTop: 4,
                                            display: 'flex',
                                            gap: 8,
                                            alignItems: 'center',
                                        }}
                                    >
                                        <span style={badge}>{doc.type}</span>
                                        <span>
                                            · {new Date(doc.createdAt).toLocaleDateString()}
                                        </span>
                                    </div>
                                </div>
                                <a
                                    href={doc.fileUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    download={doc.fileName}
                                    style={downloadLink}
                                >
                                    Download
                                </a>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>

            {/* ── Section 3: Construction Timeline (Req 18.8) ── */}
            <Section
                id="updates"
                title="Construction Updates"
                viewAllHref="/buyer-portal/updates"
            >
                {!timelineRes.success ? (
                    <p style={errorText}>{timelineRes.error}</p>
                ) : updates.length === 0 ? (
                    <p style={muted}>No construction updates have been posted yet.</p>
                ) : (
                    <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
                        {updates.map((u) => (
                            <li key={u.id} style={card}>
                                <div style={rowBetween}>
                                    <strong style={{ fontSize: 14 }}>{u.title}</strong>
                                    <span style={muted}>
                                        {new Date(u.date).toLocaleDateString()}
                                    </span>
                                </div>
                                <div
                                    style={{
                                        ...muted,
                                        marginTop: 4,
                                        display: 'flex',
                                        gap: 8,
                                        alignItems: 'center',
                                        flexWrap: 'wrap',
                                    }}
                                >
                                    <span style={badge}>
                                        {u.projectName || `Project #${u.projectId}`}
                                    </span>
                                    {u.category ? (
                                        <span style={badge}>{u.category}</span>
                                    ) : null}
                                    <span>{u.milestonePct}% complete</span>
                                </div>
                                {/* Progress bar */}
                                <div
                                    style={{
                                        marginTop: 8,
                                        height: 6,
                                        background: '#f1f5f9',
                                        borderRadius: 999,
                                    }}
                                >
                                    <div
                                        style={{
                                            width: `${Math.max(0, Math.min(100, u.milestonePct))}%`,
                                            height: '100%',
                                            background: '#2563eb',
                                            borderRadius: 999,
                                        }}
                                    />
                                </div>
                                {u.description ? (
                                    <p style={{ marginTop: 8, fontSize: 13, color: '#374151' }}>
                                        {u.description}
                                    </p>
                                ) : null}
                                {u.photos.length > 0 ? (
                                    <div
                                        style={{
                                            display: 'flex',
                                            gap: 8,
                                            marginTop: 10,
                                            flexWrap: 'wrap',
                                        }}
                                    >
                                        {u.photos.slice(0, 3).map((src, i) => (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                key={i}
                                                src={src}
                                                alt={`${u.title} photo ${i + 1}`}
                                                style={{
                                                    width: 100,
                                                    height: 75,
                                                    objectFit: 'cover',
                                                    borderRadius: 6,
                                                }}
                                            />
                                        ))}
                                    </div>
                                ) : null}
                            </li>
                        ))}
                    </ol>
                )}
            </Section>

            {/* ── Section 4: Support Tickets (Req 18.9) ── */}
            <Section
                id="tickets"
                title={`Support Tickets${tickets.length > 0 ? ` (${tickets.length})` : ''}`}
                viewAllHref="/buyer-portal/tickets"
                viewAllLabel="View all / New ticket"
            >
                {!ticketsRes.success ? (
                    <p style={errorText}>{ticketsRes.error}</p>
                ) : tickets.length === 0 ? (
                    <p style={muted}>
                        You have not raised any tickets yet.{' '}
                        <Link href="/buyer-portal/tickets" style={inlineLink}>
                            Raise a ticket
                        </Link>
                    </p>
                ) : (
                    <ul style={list}>
                        {tickets.map((t) => (
                            <li key={t.id} style={card}>
                                <div style={rowBetween}>
                                    <strong style={{ fontSize: 14 }}>{t.subject}</strong>
                                    <span style={{ display: 'flex', gap: 6 }}>
                                        <span style={badge}>{t.status}</span>
                                        <span style={badge}>{t.priority}</span>
                                    </span>
                                </div>
                                <div style={{ ...muted, marginTop: 4 }}>
                                    {t.category ? `${t.category} · ` : ''}
                                    {new Date(t.createdAt).toLocaleDateString()}
                                </div>
                                {t.resolutionNotes ? (
                                    <div
                                        style={{
                                            marginTop: 8,
                                            padding: '8px 10px',
                                            background: '#f0fdf4',
                                            borderRadius: 8,
                                            fontSize: 13,
                                        }}
                                    >
                                        <strong>Resolution:</strong> {t.resolutionNotes}
                                    </div>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                )}
            </Section>

            {/* ── Section 5: Possession Checklists (Req 18.10) ── */}
            <Section
                id="possession"
                title="Possession"
                viewAllHref="/buyer-portal/possession"
            >

                {possessionSummaries.length === 0 ? (
                    <p style={muted}>No bookings yet.</p>
                ) : (
                    <ul style={list}>
                        {possessionSummaries.map((c) => (
                            <li key={c.bookingId} style={card}>
                                <div style={rowBetween}>
                                    <strong style={{ fontSize: 14 }}>{c.label}</strong>
                                    {c.checklist ? (
                                        c.checklist.buyerSigned ? (
                                            <span
                                                style={{
                                                    ...badge,
                                                    background: '#dcfce7',
                                                    color: '#166534',
                                                }}
                                            >
                                                Signed off
                                            </span>
                                        ) : (
                                            <span style={badge}>Awaiting sign-off</span>
                                        )
                                    ) : (
                                        <span
                                            style={{
                                                ...badge,
                                                background: '#f9fafb',
                                                color: '#9ca3af',
                                            }}
                                        >
                                            Not prepared
                                        </span>
                                    )}
                                </div>

                                {c.checklist ? (
                                    <>
                                        <div style={{ ...muted, marginTop: 4 }}>
                                            {c.checklist.inspectionDate
                                                ? `Inspected ${new Date(c.checklist.inspectionDate).toLocaleDateString()}`
                                                : 'Inspection pending'}
                                            {c.checklist.inspector
                                                ? ` · ${c.checklist.inspector}`
                                                : ''}
                                            {c.checklist.handoverDate
                                                ? ` · Handover ${new Date(c.checklist.handoverDate).toLocaleDateString()}`
                                                : ''}
                                            {c.checklist.keysHanded ? ' · Keys handed' : ''}
                                        </div>
                                        {/* Snag count summary */}
                                        {c.checklist.items.length > 0 ? (
                                            <div style={{ ...muted, marginTop: 4 }}>
                                                {c.checklist.items.length} items ·{' '}
                                                {
                                                    c.checklist.items.filter(
                                                        (it) => it.status === 'Snag'
                                                    ).length
                                                }{' '}
                                                snags
                                            </div>
                                        ) : null}
                                    </>
                                ) : (
                                    <p style={{ ...muted, marginTop: 4 }}>
                                        No possession checklist has been prepared yet.
                                    </p>
                                )}

                                <div style={{ marginTop: 10 }}>
                                    <Link href="/buyer-portal/possession" style={inlineLink}>
                                        View &amp; manage possession →
                                    </Link>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Section>

        </main>
    )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({
    id,
    title,
    viewAllHref,
    viewAllLabel,
    children,
}: {
    id: string
    title: string
    viewAllHref: string
    viewAllLabel?: string
    children: React.ReactNode
}) {
    return (
        <section id={id} style={{ marginBottom: 40 }}>
            <div style={{ ...rowBetween, marginBottom: 12 }}>
                <h2 style={{ ...h2, margin: 0 }}>{title}</h2>
                <Link href={viewAllHref} style={inlineLink}>
                    {viewAllLabel ?? 'View all →'}
                </Link>
            </div>
            {children}
        </section>
    )
}

function Detail({ label, value }: { label: string; value: string | null }) {
    if (!value) return null
    return (
        <>
            <dt style={{ color: '#6b7280', fontSize: 13 }}>{label}</dt>
            <dd style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{value}</dd>
        </>
    )
}

// ── Style constants ───────────────────────────────────────────────────────────

const rowBetween: CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
}

const cell: CSSProperties = { padding: '6px 8px' }

const inlineLink: CSSProperties = {
    color: '#2563eb',
    fontSize: 13,
    textDecoration: 'none',
    fontWeight: 500,
}

const downloadLink: CSSProperties = {
    color: '#2563eb',
    fontSize: 13,
    fontWeight: 600,
    textDecoration: 'none',
}
