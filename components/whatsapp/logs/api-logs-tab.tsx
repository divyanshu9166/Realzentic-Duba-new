'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  RefreshCw, Trash2, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, AlertCircle, Wifi,
  Send, Radio, MessageSquare, Filter
} from 'lucide-react'

interface ApiLogEntry {
  id: string
  ts: string
  type: 'broadcast_send' | 'webhook_status' | 'webhook_message'
  status: 'success' | 'error' | 'skipped'
  phone?: string
  messageId?: string
  templateName?: string
  eventStatus?: string
  broadcastId?: string
  broadcastName?: string
  contactName?: string
  request?: Record<string, unknown>
  response?: Record<string, unknown>
  webhookPayload?: Record<string, unknown>
  errorMessage?: string
}

const TYPE_CONFIG = {
  broadcast_send:  { label: 'Broadcast Send',   icon: Send,         color: 'text-blue-600',   bg: 'bg-blue-50 border-blue-200' },
  webhook_status:  { label: 'Webhook Status',   icon: Wifi,         color: 'text-purple-600', bg: 'bg-purple-50 border-purple-200' },
  webhook_message: { label: 'Incoming Message', icon: MessageSquare, color: 'text-green-600',  bg: 'bg-green-50 border-green-200' },
} as const

const STATUS_CONFIG = {
  success: { icon: CheckCircle2, color: 'text-green-600', label: 'Success' },
  error:   { icon: XCircle,      color: 'text-red-500',   label: 'Error' },
  skipped: { icon: AlertCircle,  color: 'text-yellow-500', label: 'Skipped' },
} as const

const EVENT_STATUS_COLORS: Record<string, string> = {
  sent:      'bg-blue-100 text-blue-700',
  delivered: 'bg-cyan-100 text-cyan-700',
  read:      'bg-green-100 text-green-700',
  failed:    'bg-red-100 text-red-700',
  replied:   'bg-violet-100 text-violet-700',
}

function JsonBlock({ data }: { data: unknown }) {
  return (
    <pre className="text-[11px] bg-gray-950 text-green-300 rounded-lg p-3 overflow-x-auto leading-relaxed max-h-64 overflow-y-auto">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

function LogRow({ log }: { log: ApiLogEntry }) {
  const [open, setOpen] = useState(false)
  const tc = TYPE_CONFIG[log.type]
  const sc = STATUS_CONFIG[log.status]
  const Icon = tc.icon
  const StatusIcon = sc.icon

  const time = new Date(log.ts).toLocaleTimeString('en-AE', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  })
  const date = new Date(log.ts).toLocaleDateString('en-AE', {
    day: '2-digit', month: 'short',
  })

  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${log.status === 'error' ? 'border-red-200' : 'border-border'}`}>
      {/* Row Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-hover text-left transition-colors"
      >
        {/* Expand icon */}
        <span className="text-muted shrink-0">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>

        {/* Type badge */}
        <span className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border shrink-0 ${tc.bg} ${tc.color}`}>
          <Icon className="w-3.5 h-3.5" />
          {tc.label}
        </span>

        {/* Status */}
        <StatusIcon className={`w-4 h-4 shrink-0 ${sc.color}`} />

        {/* Event status badge (delivered/read/etc) */}
        {log.eventStatus && (
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${EVENT_STATUS_COLORS[log.eventStatus] ?? 'bg-gray-100 text-gray-600'}`}>
            {log.eventStatus.toUpperCase()}
          </span>
        )}

        {/* Contact name + phone */}
        <span className="text-sm text-foreground font-mono truncate flex-1">
          {log.contactName && log.contactName !== 'Unknown'
            ? <><span className="font-semibold not-italic">{log.contactName}</span> <span className="text-muted">{log.phone}</span></>
            : (log.phone ?? log.messageId ?? '—')}
        </span>

        {/* Broadcast name */}
        {log.broadcastName && (
          <span className="text-xs text-muted shrink-0 hidden sm:inline truncate max-w-[140px]">
            {log.broadcastName}
          </span>
        )}

        {/* Time */}
        <span className="text-xs text-muted shrink-0">
          {date} {time}
        </span>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-border bg-surface px-4 py-4 space-y-4">
          {/* Error message */}
          {log.errorMessage && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
              <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-red-700 mb-0.5">Error</p>
                <p className="text-sm text-red-600">{log.errorMessage}</p>
              </div>
            </div>
          )}

          {/* Meta data grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {log.messageId && (
              <div>
                <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Message ID (wamid)</p>
                <p className="text-xs font-mono text-foreground break-all">{log.messageId}</p>
              </div>
            )}
            {log.contactName && (
              <div>
                <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Contact</p>
                <p className="text-xs font-mono text-foreground">{log.contactName}</p>
              </div>
            )}
            {log.phone && (
              <div>
                <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Phone</p>
                <p className="text-xs font-mono text-foreground">{log.phone}</p>
              </div>
            )}
            {log.broadcastName && (
              <div>
                <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Broadcast</p>
                <p className="text-xs font-mono text-foreground">{log.broadcastName}</p>
              </div>
            )}
            {log.templateName && (
              <div>
                <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Template</p>
                <p className="text-xs font-mono text-foreground">{log.templateName}</p>
              </div>
            )}
            {log.broadcastId && (
              <div>
                <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Broadcast ID</p>
                <p className="text-xs font-mono text-foreground break-all">{log.broadcastId}</p>
              </div>
            )}
          </div>

          {/* Request payload */}
          {log.request && (
            <div>
              <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">
                📤 Request sent to Meta
              </p>
              <JsonBlock data={log.request} />
            </div>
          )}

          {/* Response payload */}
          {log.response && (
            <div>
              <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">
                📥 Response from Meta
              </p>
              <JsonBlock data={log.response} />
            </div>
          )}

          {/* Webhook payload */}
          {log.webhookPayload && (
            <div>
              <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">
                🔔 Raw Webhook Payload from Meta
              </p>
              <JsonBlock data={log.webhookPayload} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

type FilterType = 'all' | 'broadcast_send' | 'webhook_status' | 'webhook_message'

export function ApiLogsTab() {
  const [logs, setLogs] = useState<ApiLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [filter, setFilter] = useState<FilterType>('all')
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/api-logs?limit=100')
      if (res.ok) {
        const data = await res.json()
        setLogs(data.logs ?? [])
        setLastRefresh(new Date())
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchLogs, 4000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [autoRefresh, fetchLogs])

  const handleClear = async () => {
    setClearing(true)
    try {
      await fetch('/api/whatsapp/api-logs', { method: 'DELETE' })
      setLogs([])
    } finally {
      setClearing(false)
    }
  }

  const filtered = filter === 'all' ? logs : logs.filter(l => l.type === filter)
  const errorCount = logs.filter(l => l.status === 'error').length
  const webhookCount = logs.filter(l => l.type === 'webhook_status').length
  const broadcastCount = logs.filter(l => l.type === 'broadcast_send').length

  return (
    <div className="space-y-5">

      {/* Header + stats */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Radio className="w-4 h-4 text-accent" />
            Meta API Logs
          </h2>
          <p className="text-xs text-muted mt-0.5">
            Live feed of every Meta API call and webhook event. Use this to debug delivery issues.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
              autoRefresh
                ? 'bg-green-50 text-green-700 border-green-200'
                : 'bg-surface text-muted border-border hover:text-foreground'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
            {autoRefresh ? 'Live' : 'Paused'}
          </button>

          <button
            onClick={fetchLogs}
            className="p-1.5 rounded-lg border border-border text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
            title="Refresh now"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <span className="text-[11px] text-muted italic">
            Live DB feed · auto-refreshes
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl bg-surface border border-border text-center">
          <p className="text-2xl font-bold text-foreground">{logs.length}</p>
          <p className="text-xs text-muted mt-0.5">Total Events</p>
        </div>
        <div className="p-3 rounded-xl bg-surface border border-border text-center">
          <p className="text-2xl font-bold text-blue-600">{broadcastCount}</p>
          <p className="text-xs text-muted mt-0.5">Broadcast Sends</p>
        </div>
        <div className="p-3 rounded-xl bg-surface border border-border text-center">
          <p className="text-2xl font-bold text-purple-600">{webhookCount}</p>
          <p className="text-xs text-muted mt-0.5">Webhook Events</p>
        </div>
        <div className={`p-3 rounded-xl border text-center ${errorCount > 0 ? 'bg-red-50 border-red-200' : 'bg-surface border-border'}`}>
          <p className={`text-2xl font-bold ${errorCount > 0 ? 'text-red-600' : 'text-foreground'}`}>{errorCount}</p>
          <p className="text-xs text-muted mt-0.5">Errors</p>
        </div>
      </div>

      {/* Webhook health hint */}
      {logs.length > 0 && webhookCount === 0 && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-yellow-50 border border-yellow-200">
          <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-yellow-800">Broadcasts sent but no Delivered/Read updates</p>
            <p className="text-xs text-yellow-700 mt-1">
              Messages were sent successfully but Meta hasn't sent any status callbacks (delivered/read). This almost always means your <strong>Webhook URL is not registered</strong> in the Meta Developer Console. Go to: Meta Developer Console → Your App → WhatsApp → Configuration → Webhook. Set your URL to <code className="font-mono bg-yellow-100 px-1 rounded">https://yourdomain.com/api/whatsapp/webhook</code> and subscribe to the <code className="font-mono bg-yellow-100 px-1 rounded">messages</code> field.
            </p>
          </div>
        </div>
      )}

      {/* Last refresh time */}
      {lastRefresh && (
        <p className="text-[11px] text-muted text-right -mt-2">
          Last updated: {lastRefresh.toLocaleTimeString('en-AE')}
          {autoRefresh && ' · auto-refreshing every 4s'}
        </p>
      )}

      {/* Filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-3.5 h-3.5 text-muted" />
        {(['all', 'broadcast_send', 'webhook_status'] as FilterType[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
              filter === f
                ? 'bg-accent text-white border-accent'
                : 'bg-surface text-muted border-border hover:text-foreground'
            }`}
          >
            {f === 'all' ? `All (${logs.length})` :
             f === 'broadcast_send' ? `Sends (${broadcastCount})` :
             `Webhooks (${webhookCount})`}
          </button>
        ))}
      </div>

      {/* Log entries */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted text-sm gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Loading logs...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted">
          <Radio className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No logs yet</p>
          <p className="text-xs mt-1">
            Send a broadcast to see API calls appear here in real time.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(log => (
            <LogRow key={log.id} log={log} />
          ))}
        </div>
      )}
    </div>
  )
}