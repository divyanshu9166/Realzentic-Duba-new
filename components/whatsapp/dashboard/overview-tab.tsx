"use client"

import { useCallback, useEffect, useState } from 'react'
import {
  MessageSquare,
  UserPlus,
  Banknote,
  Send,
} from 'lucide-react'

import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  ResponseTimeSummary,
} from '@/lib/wa-dashboard/types'

import { MetricCard } from '@/components/whatsapp/dashboard/metric-card'
import { SkeletonCard } from '@/components/whatsapp/dashboard/skeleton'
import { QuickActions } from '@/components/whatsapp/dashboard/quick-actions'
import { ConversationsChart } from '@/components/whatsapp/dashboard/conversations-chart'
import { PipelineDonut } from '@/components/whatsapp/dashboard/pipeline-donut'
import { ResponseTimeChart } from '@/components/whatsapp/dashboard/response-time-chart'
import { ActivityFeed } from '@/components/whatsapp/dashboard/activity-feed'

type RangeDays = 7 | 30 | 90

export function OverviewTab() {
  const [metrics, setMetrics] = useState<MetricsBundle | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)

  const [range, setRange] = useState<RangeDays>(30)
  // Cache per range so switching doesn't re-fetch already-loaded data.
  const [series, setSeries] = useState<Record<RangeDays, ConversationsSeriesPoint[] | null>>({
    7: null,
    30: null,
    90: null,
  })
  const [seriesLoading, setSeriesLoading] = useState(true)

  const [pipeline, setPipeline] = useState<PipelineDonutData | null>(null)
  const [pipelineLoading, setPipelineLoading] = useState(true)

  const [responseTime, setResponseTime] = useState<ResponseTimeSummary | null>(null)
  const [responseTimeLoading, setResponseTimeLoading] = useState(true)

  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(true)

  // Initial load — fetch all sections in one API call (range=30 default).
  const loadAll = useCallback(() => {
    fetch('/api/whatsapp/dashboard?range=30', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data.metrics) {
          setMetrics(data.metrics)
          setMetricsLoading(false)
        }
        if (data.series) {
          setSeries((prev) => ({ ...prev, 30: data.series }))
          setSeriesLoading(false)
        }
        if (data.pipeline) {
          setPipeline(data.pipeline)
          setPipelineLoading(false)
        }
        if (data.responseTime) {
          setResponseTime(data.responseTime)
          setResponseTimeLoading(false)
        }
        if (data.activity) {
          setActivity(data.activity)
          setActivityLoading(false)
        }
      })
      .catch((err) => {
        console.error('[dashboard] load failed:', err)
        setMetricsLoading(false)
        setSeriesLoading(false)
        setPipelineLoading(false)
        setResponseTimeLoading(false)
        setActivityLoading(false)
      })
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Range switch — re-fetches only the series section for that range if not cached.
  const handleRangeChange = useCallback(
    (r: RangeDays) => {
      setRange(r)
      if (series[r] !== null) return
      setSeriesLoading(true)
      fetch(`/api/whatsapp/dashboard?range=${r}`, { cache: 'no-store' })
        .then((res) => res.json())
        .then((data) => {
          if (data.series) setSeries((prev) => ({ ...prev, [r]: data.series }))
        })
        .catch((err) => console.error('[dashboard] series failed:', err))
        .finally(() => setSeriesLoading(false))
    },
    [series],
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted">
          Live analytics across conversations, contacts, deals, broadcasts, and automations.
        </p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricsLoading || !metrics ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title="Active Conversations"
              value={metrics.activeConversations.current.toLocaleString()}
              icon={MessageSquare}
              delta={{
                sign: metrics.activeConversations.previous,
                label: deltaLabel(metrics.activeConversations.previous, 'new today vs yesterday'),
              }}
            />
            <MetricCard
              title="New Contacts Today"
              value={metrics.newContactsToday.current.toLocaleString()}
              icon={UserPlus}
              delta={{
                sign:
                  metrics.newContactsToday.current - metrics.newContactsToday.previous,
                label: deltaLabel(
                  metrics.newContactsToday.current - metrics.newContactsToday.previous,
                  'vs yesterday',
                ),
              }}
            />
            <MetricCard
              title="Open Deals Value"
              value={formatCurrency(metrics.openDealsValue)}
              icon={Banknote}
              subtitle={`${metrics.openDealsCount} open deal${metrics.openDealsCount === 1 ? '' : 's'}`}
            />
            <MetricCard
              title="Messages Sent Today"
              value={metrics.messagesSentToday.current.toLocaleString()}
              icon={Send}
              delta={{
                sign:
                  metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                label: deltaLabel(
                  metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                  'vs yesterday',
                ),
              }}
            />
          </>
        )}
      </div>

      {/* Quick actions */}
      <QuickActions />

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="h-full lg:col-span-3">
          <ConversationsChart
            series={series}
            loading={seriesLoading}
            range={range}
            onRangeChange={handleRangeChange}
          />
        </div>
        <div className="h-full lg:col-span-2">
          <PipelineDonut data={pipeline} loading={pipelineLoading} />
        </div>
      </div>

      {/* Response time */}
      <ResponseTimeChart data={responseTime} loading={responseTimeLoading} />

      {/* Activity feed */}
      <ActivityFeed items={activity} loading={activityLoading} />
    </div>
  )
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(v: number): string {
  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v)
}

function deltaLabel(delta: number, suffix: string): string {
  if (delta === 0) return `No change ${suffix}`
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toLocaleString()} ${suffix}`
}
