import { NextRequest, NextResponse } from 'next/server'
import { ingestPortalLead } from '@/app/actions/portal-integration'

/**
 * Property-portal webhook endpoint (Module 12 / Requirement 15.3, 15.6).
 *
 * POST /api/webhooks/portals/[portal]
 *
 * Receives an inbound lead webhook from a property portal (Bayut, Property
 * Finder, or Dubizzle). The `[portal]` slug identifies the
 * source portal and is forwarded to `ingestPortalLead`, which resolves the
 * PortalConfig, validates the payload, deduplicates, and persists records.
 *
 * This route is intentionally unauthenticated by user session — the portal is
 * authenticated by its PortalConfig (enabled flag + API key) inside the action,
 * not by a logged-in user.
 *
 * The action returns a discriminated outcome that this handler maps to HTTP
 * status codes. Invalid payloads are rejected WITHOUT creating any records
 * (Req 15.6): the action validates before any write, so a `rejected` outcome
 * guarantees nothing was persisted.
 */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ portal: string }> },
) {
    const { portal } = await params

    // Parse the JSON body. A malformed body is a client error (400) and must not
    // reach the ingestion path.
    let payload: unknown
    try {
        payload = await req.json()
    } catch {
        return NextResponse.json(
            { status: 'rejected', error: 'Invalid JSON body' },
            { status: 400 },
        )
    }

    try {
        const result = await ingestPortalLead(portal, payload)

        // Internal failure surfaced by the action.
        if (!result.success) {
            return NextResponse.json({ error: result.error }, { status: 500 })
        }

        const outcome = result.data
        switch (outcome.status) {
            // Unknown or disabled portal — acknowledged, nothing written (Req 15.4).
            case 'ignored':
                return NextResponse.json(outcome, { status: 200 })

            // Validation failure — no records created (Req 15.6).
            case 'rejected':
                return NextResponse.json(outcome, { status: 422 })

            // Duplicate contact — a deduplicated PortalLead was recorded.
            case 'duplicate':
                return NextResponse.json(outcome, { status: 200 })

            // New Contact + Lead created and assignee notified (Req 15.3).
            case 'created':
                return NextResponse.json(outcome, { status: 201 })

            default: {
                // Exhaustiveness guard — keeps the switch honest if outcomes change.
                const _exhaustive: never = outcome
                return NextResponse.json(
                    { error: 'Unhandled ingestion outcome' },
                    { status: 500 },
                )
            }
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        console.error('[webhooks/portals] ingestion error:', error)
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
