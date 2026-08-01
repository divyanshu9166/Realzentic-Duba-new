/**
 * lib/queues/reminders-worker.ts
 *
 * Boots the daily WhatsApp-reminder sweep as a BullMQ repeatable (cron) job.
 *
 * Why this is cheap: BullMQ's job scheduler does NOT poll or busy-loop — it
 * stores the next run time in Redis and wakes only at that moment. Idle CPU is
 * effectively zero; the worker runs for a few seconds once a day.
 *
 * Schedule is configurable via env:
 *   - REMINDERS_CRON  (default '0 9 * * *'  → 09:00 daily)
 *   - REMINDERS_TZ    (default 'Asia/Dubai')
 *
 * The scheduler is idempotent (upsert), so restarting the server never creates
 * duplicate schedules. The HTTP route /api/cron/whatsapp-reminders remains as a
 * manual / external-scheduler fallback.
 */

import { createRemindersWorker, getRemindersQueue, QUEUE_REMINDERS } from './jobs'
import {
    runFollowUpReminders,
    runSiteVisitReminders,
    runPostVisitFeedback,
    runPaymentReminders,
    runTaskReminders,
} from '@/app/actions/reminders'

const SCHEDULER_ID = 'daily-whatsapp-reminders'
const JOB_NAME = 'whatsapp-reminders'

let started = false

export async function startRemindersWorker(): Promise<void> {
    if (started) return
    started = true

    // 1. Worker that performs the sweep when a scheduled job fires.
    const worker = createRemindersWorker(async () => {
        const followUps = await runFollowUpReminders()
        const siteVisits = await runSiteVisitReminders()
        const postVisits = await runPostVisitFeedback()
        const payments = await runPaymentReminders()
        const tasks = await runTaskReminders()
        console.log(
            '[reminders-worker] sweep complete',
            JSON.stringify({ followUps, siteVisits, postVisits, payments, tasks }),
        )
    })

    worker.on('failed', (job, err) => {
        console.error(`[reminders-worker] job ${job?.id} failed:`, err?.message)
    })

    // 2. Register (idempotently) the daily repeatable schedule.
    const pattern = process.env.REMINDERS_CRON ?? '0 9 * * *'
    const tz = process.env.REMINDERS_TZ ?? 'Asia/Dubai'
    try {
        await getRemindersQueue().upsertJobScheduler(
            SCHEDULER_ID,
            { pattern, tz },
            { name: JOB_NAME, data: {} },
        )
        console.log(`[reminders-worker] scheduled daily sweep at "${pattern}" (${tz})`)
    } catch (err) {
        // Redis unavailable at boot — the worker will pick up the schedule on a
        // later restart once Redis is reachable. Non-fatal.
        console.warn(`[reminders-worker] could not register schedule for ${QUEUE_REMINDERS}:`, err)
    }
}
