'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  BrainCircuit, Settings2, BookOpen, Code2, Loader2,
  ToggleRight, ToggleLeft, Zap,
} from 'lucide-react'

import { ConfigPanel } from './config-panel'
import { KnowledgeBase } from './knowledge-base'
import { SystemPromptEditor } from './system-prompt-editor'
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/ai-agent/system-prompt'

// ── Types ────────────────────────────────────────────────────────────────────

interface AgentConfig {
  enabled: boolean
  agent_name: string
  system_prompt: string
  fallback_message: string
  confidence_threshold: number
  max_response_tokens: number
  response_delay_ms: number
  languages: string[]
}

const DEFAULT_CONFIG: AgentConfig = {
  enabled: false,
  agent_name: 'Assistant',
  system_prompt: DEFAULT_SYSTEM_PROMPT,
  fallback_message: "Let me connect you with our team.",
  confidence_threshold: 0.45,
  max_response_tokens: 300,
  response_delay_ms: 1500,
  languages: ['en'],
}

// ── Sub-tab definitions ──────────────────────────────────────────────────────

const SUB_TABS = [
  { id: 'config',  label: 'Configuration', shortLabel: 'Config',  icon: Settings2 },
  { id: 'knowledge', label: 'Knowledge Base', shortLabel: 'Knowledge', icon: BookOpen },
  { id: 'prompt',  label: 'System Prompt', shortLabel: 'Prompt',  icon: Code2 },
] as const

type SubTabId = (typeof SUB_TABS)[number]['id']
function isSubTabId(v: string | null): v is SubTabId {
  return !!v && SUB_TABS.some(t => t.id === v)
}

// ── Main component ──────────────────────────────────────────────────────────

export function AgentTab() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const qSub = searchParams.get('agentTab')
  const subTab: SubTabId = isSubTabId(qSub) ? qSub : 'config'

  const setSubTab = (id: SubTabId) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', 'agent')
    params.set('agentTab', id)
    router.replace(`/whatsapp-marketing?${params.toString()}`, { scroll: false })
  }

  const [config, setConfig] = useState<AgentConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  // ── Load config from API ─────────────────────────────────────────────────
  useEffect(() => {
    let active = true

    fetch('/api/whatsapp/agent/config')
      .then(async (res) => {
        if (!res.ok || !active) return

        const data = await res.json()
        if (!active) return

        setConfig({
          enabled:              data.enabled              ?? DEFAULT_CONFIG.enabled,
          agent_name:           data.agent_name           ?? DEFAULT_CONFIG.agent_name,
          system_prompt:        data.system_prompt        ?? DEFAULT_SYSTEM_PROMPT,
          fallback_message:     data.fallback_message     ?? DEFAULT_CONFIG.fallback_message,
          confidence_threshold: data.confidence_threshold ?? DEFAULT_CONFIG.confidence_threshold,
          max_response_tokens:  data.max_response_tokens  ?? DEFAULT_CONFIG.max_response_tokens,
          response_delay_ms:    data.response_delay_ms    ?? DEFAULT_CONFIG.response_delay_ms,
          languages:            data.languages            ?? DEFAULT_CONFIG.languages,
        })
      })
      .catch(() => {
        // use defaults
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  // ── Save config to API ───────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/whatsapp/agent/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (res.ok) setSavedAt(new Date())
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }

  // ── Loading skeleton ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Loading agent settings…</span>
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <BrainCircuit className="w-5 h-5 text-accent" />
            AI WhatsApp Agent
          </h2>
          <p className="text-xs text-muted mt-0.5">
            Powered by Groq Llama + Local RAG · Offline embeddings · Zero extra cost
          </p>
        </div>

        {/* Live status pill */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setConfig(c => ({ ...c, enabled: !c.enabled }))
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold border transition-all ${
              config.enabled
                ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                : 'bg-surface text-muted border-border hover:text-foreground'
            }`}
          >
            {config.enabled
              ? <><ToggleRight className="w-4 h-4" /><span className="hidden sm:inline">Agent Active</span><span className="sm:hidden">Active</span></>
              : <><ToggleLeft className="w-4 h-4" /><span className="hidden sm:inline">Agent Disabled</span><span className="sm:hidden">Off</span></>
            }
          </button>

          {config.enabled && (
            <span className="flex items-center gap-1.5 text-xs text-green-700 animate-pulse">
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span className="hidden sm:inline">Handling messages</span>
            </span>
          )}
        </div>
      </div>

      {/* Sub-tab bar */}
      <div className="flex gap-1 p-1 rounded-xl border border-border bg-surface overflow-x-auto no-scrollbar">
        {SUB_TABS.map(t => {
          const Icon = t.icon
          const active = subTab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
                active
                  ? 'bg-surface-light text-accent shadow-sm border border-border/50'
                  : 'text-muted hover:text-foreground hover:bg-surface-hover'
              }`}
            >
              <Icon className="size-3.5 sm:size-4 shrink-0" />
              <span className="sm:hidden">{t.shortLabel}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* Sub-tab content */}
      <div className="min-h-[400px]">
        {subTab === 'config' && (
          <ConfigPanel
            config={config}
            onConfigChange={(c) => setConfig(c as AgentConfig)}
            onSave={handleSave}
            saving={saving}
            savedAt={savedAt}
          />
        )}
        {subTab === 'knowledge' && <KnowledgeBase />}
        {subTab === 'prompt' && (
          <SystemPromptEditor
            value={config.system_prompt}
            onChange={(v) => setConfig(c => ({ ...c, system_prompt: v }))}
            onSave={handleSave}
            saving={saving}
            savedAt={savedAt}
          />
        )}
      </div>
    </div>
  )
}
