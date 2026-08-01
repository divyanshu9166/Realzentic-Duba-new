/**
 * app/api/webhooks/instagram/route.ts
 *
 * LEGACY ROUTE — kept only so any Meta App Dashboard still pointing at the old
 * callback URL (https://crm.realzentic.com/api/webhooks/instagram) keeps
 * working. This file was previously EMPTY, which meant webhook verification and
 * message delivery silently failed and the Instagram inbox stayed empty.
 *
 * All real logic now lives in /api/social/webhook, which handles the Instagram
 * `object: "instagram"` payload and Facebook `object: "page"` payload.
 *
 * Please update the Meta webhook callback URL to:
 *   https://crm.realzentic.com/api/social/webhook
 */

import { NextRequest } from 'next/server'
import { GET as socialGet, POST as socialPost } from '@/app/api/social/webhook/route'

export function GET(req: NextRequest) {
  return socialGet(req)
}

export function POST(req: NextRequest) {
  return socialPost(req)
}
