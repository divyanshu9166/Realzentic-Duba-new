import { prisma } from '@/lib/db'
import { requireBuyerAuth } from '@/lib/buyer-session'
import { getPaymentOptions } from '@/app/actions/buyer-portal'
import { BuyerNav } from '../_components/BuyerNav'
import { card, list, muted, h2, badge, formatAed, page as pageStyle, primaryButton } from '../_components/styles'

export const dynamic = 'force-dynamic'

/**
 * Buyer payment tracker (Req 18.5, 18.11, A5).
 *
 * Scoped to the authenticated buyer (Req 18.6, 21.2): lists each booking with
 * its milestone schedule and outstanding balance. Payment options come from
 * `getPaymentOptions`, which exposes a "Pay Now" action when the online gateway
 * is enabled (A5) or otherwise renders manual bank-transfer instructions (Req 18.11).
 */
export default async function BuyerPaymentsPage() {
    const { contactId } = await requireBuyerAuth()

    const bookings = await prisma.booking.findMany({
        where: { contactId },
        orderBy: { bookingDate: 'desc' },
        select: {
            id: true,
            agreementValue: true,
            unit: { select: { unitNumber: true } },
            milestones: {
                orderBy: { dueDate: 'asc' },
                select: { id: true, name: true, dueDate: true, amount: true, paidAmount: true, status: true },
            },
        },
    })

    // Payment mode + (when manual) bank-transfer instructions are the same across
    // bookings; resolve once. `getPaymentOptions` is itself scoped to the buyer.
    const optionsRes = await getPaymentOptions()
    const options = optionsRes.success ? optionsRes.data : null

    return (
        <main style={pageStyle}>
            <BuyerNav active="payments" title="Payments" subtitle="Track your milestones and pay dues" />

            {bookings.length === 0 ? (
                <p style={muted}>No bookings yet.</p>
            ) : (
                <ul style={list}>
                    {bookings.map((b) => {
                        const totalDue = b.milestones.reduce(
                            (sum, m) => sum + Math.max(0, Number(m.amount) - Number(m.paidAmount)),
                            0
                        )
                        return (
                            <li key={b.id} style={card}>
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        gap: 12,
                                        flexWrap: 'wrap',
                                    }}
                                >
                                    <strong>{b.unit?.unitNumber ? `Unit ${b.unit.unitNumber}` : `Booking #${b.id}`}</strong>
                                    <span style={muted}>Agreement {formatAed(b.agreementValue.toString())}</span>
                                </div>

                                {b.milestones.length === 0 ? (
                                    <p style={{ ...muted, marginTop: 8 }}>No payment milestones scheduled yet.</p>
                                ) : (
                                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12, fontSize: 14 }}>
                                        <thead>
                                            <tr style={{ textAlign: 'left', color: '#6b7280' }}>
                                                <th style={cellStyle}>Milestone</th>
                                                <th style={cellStyle}>Due</th>
                                                <th style={cellStyle}>Amount</th>
                                                <th style={cellStyle}>Paid</th>
                                                <th style={cellStyle}>Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {b.milestones.map((m) => (
                                                <tr key={m.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                                                    <td style={cellStyle}>{m.name}</td>
                                                    <td style={cellStyle}>{new Date(m.dueDate).toLocaleDateString()}</td>
                                                    <td style={cellStyle}>{formatAed(m.amount.toString())}</td>
                                                    <td style={cellStyle}>{formatAed(m.paidAmount.toString())}</td>
                                                    <td style={cellStyle}>
                                                        <span style={badge}>{m.status}</span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}

                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        gap: 12,
                                        marginTop: 12,
                                        flexWrap: 'wrap',
                                    }}
                                >
                                    <div style={{ fontWeight: 600 }}>
                                        Outstanding: {formatAed(totalDue)}
                                    </div>
                                    {options?.mode === 'online' && totalDue > 0 ? (
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

            {options?.mode === 'manual' && options.manual ? (
                <section style={{ ...card, marginTop: 20 }}>
                    <h2 style={h2}>How to pay</h2>
                    <p style={{ ...muted, marginBottom: 12 }}>
                        Online payment is not enabled. Use the bank-transfer details below and your receipt will be
                        recorded against your milestones.
                    </p>
                    <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', margin: 0 }}>
                        <Detail label="Bank" value={options.manual.bankName} />
                        <Detail label="Account name" value={options.manual.accountName} />
                        <Detail label="Account number" value={options.manual.accountNumber} />
                        <Detail label="IBAN" value={options.manual.iban} />
                    </dl>
                    {options.manual.qrUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={options.manual.qrUrl}
                            alt="Payment QR code"
                            style={{ marginTop: 16, maxWidth: 180, borderRadius: 8 }}
                        />
                    ) : null}
                </section>
            ) : null}
        </main>
    )
}

function Detail({ label, value }: { label: string; value: string | null }) {
    if (!value) return null
    return (
        <>
            <dt style={{ color: '#6b7280', fontSize: 14 }}>{label}</dt>
            <dd style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{value}</dd>
        </>
    )
}

const cellStyle = { padding: '6px 8px' } as const
