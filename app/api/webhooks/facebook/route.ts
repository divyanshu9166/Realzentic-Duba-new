/**
 * app/api/webhooks/facebook/route.ts
 *
 * LEGACY ROUTE — kept only so any Meta App Dashboard still pointing at the old
 * callback URL (https://crm.realzentic.com/api/webhooks/facebook) keeps
 * working. All real logic now lives in /api/social/webhook, which correctly
 * resolves the customer's display name (first_name + last_name) and supports
 * both Facebook Pages and Instagram in one place.
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
