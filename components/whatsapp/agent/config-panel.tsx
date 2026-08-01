'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Settings2, Save, Loader2, ToggleLeft, ToggleRight,
  Info, AlertCircle, CheckCircle2,
} from 'lucide-react'

interface AgentConfig {
  enabled: boolean
  agent_name: string
  fallback_message: string
  confidence_threshold: number
  max_response_tokens: number
  response_delay_ms: number
  languages: string[]
}

const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'Arabic' },
]

interface Props {
  config: AgentConfig
  onConfigChange: (c: AgentConfig) => void
  onSave: () => Promise<void>
  saving: boolean
  savedAt: Date | null
}

export function ConfigPanel({ config, onConfigChange, onSave, saving, savedAt }: Props) {
  const set = <K extends keyof AgentConfig>(key: K, val: AgentConfig[K]) =>
    onConfigChange({ ...config, [key]: val })

  const toggleLang = (code: string) => {
    const langs = config.languages.includes(code)
      ? config.languages.filter((l) => l !== code)
      : [...config.languages, code]
    set('languages', langs)
  }

  return (
    <div className="space-y-6">

      {/* Enable / Disable */}
      <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-surface border border-border">
        <div>
          <p className="text-sm font-semibold text-foreground">AI Agent Active</p>
          <p className="text-xs text-muted mt-0.5">
            When enabled, incoming text messages are handled by the AI before reaching your inbox.
          </p>
        </div>
        <button
          onClick={() => set('enabled', !config.enabled)}
          className="shrink-0 mt-0.5"
        >
          {config.enabled
            ? <ToggleRight className="w-10 h-10 text-accent" />
            : <ToggleLeft className="w-10 h-10 text-muted" />}
        </button>
      </div>

      {!config.enabled && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-yellow-50 border border-yellow-200 text-xs text-yellow-800">
          <AlertCircle className="w-4 h-4 shrink-0 text-yellow-600" />
          Agent is disabled. Toggle above to start handling messages automatically.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Agent Name */}
        <div>
          <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
            Agent Name
          </label>
          <input
            type="text"
            value={config.agent_name}
            onChange={(e) => set('agent_name', e.target.value)}
            placeholder="e.g. Maya, Property Concierge, Support"
            className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors"
          />
          <p className="text-[11px] text-muted mt-1">The name the AI signs off as in messages.</p>
        </div>

        {/* Response Delay */}
        <div>
          <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
            Response Delay — {config.response_delay_ms}ms
          </label>
          <input
            type="range" min={0} max={5000} step={100}
            value={config.response_delay_ms}
            onChange={(e) => set('response_delay_ms', Number(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="flex justify-between text-[10px] text-muted mt-0.5">
            <span>Instant</span><span>5 s</span>
          </div>
          <p className="text-[11px] text-muted mt-1">Simulates typing delay for a more human feel.</p>
        </div>

        {/* Confidence Threshold */}
        <div>
          <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
            Confidence Threshold — {config.confidence_threshold.toFixed(2)}
          </label>
          <input
            type="range" min={0.1} max={0.9} step={0.05}
            value={config.confidence_threshold}
            onChange={(e) => set('confidence_threshold', Number(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="flex justify-between text-[10px] text-muted mt-0.5">
            <span>Loose (0.1)</span><span>Strict (0.9)</span>
          </div>
          <p className="text-[11px] text-muted mt-1">Below this cosine similarity, the AI escalates to human.</p>
        </div>

        {/* Max Response Tokens */}
        <div>
          <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
            Max Response Tokens — {config.max_response_tokens}
          </label>
          <input
            type="range" min={100} max={800} step={50}
            value={config.max_response_tokens}
            onChange={(e) => set('max_response_tokens', Number(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="flex justify-between text-[10px] text-muted mt-0.5">
            <span>Short (100)</span><span>Long (800)</span>
          </div>
          <p className="text-[11px] text-muted mt-1">Shorter = cheaper + faster. WhatsApp messages should stay ≤300.</p>
        </div>
      </div>

      {/* Fallback Message */}
      <div>
        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">
          Fallback / Handoff Message
        </label>
        <textarea
          value={config.fallback_message}
          onChange={(e) => set('fallback_message', e.target.value)}
          rows={3}
          placeholder="Let me connect you with our team."
          className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors resize-none"
        />
        <p className="text-[11px] text-muted mt-1">
          Sent when the AI cannot answer confidently or detects a handoff request.
        </p>
      </div>

      {/* Languages */}
      <div>
        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
          Supported Languages
        </label>
        <div className="flex flex-wrap gap-2">
          {LANGUAGE_OPTIONS.map((l) => {
            const active = config.languages.includes(l.code)
            return (
              <button
                key={l.code}
                onClick={() => toggleLang(l.code)}
                className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                  active
                    ? 'bg-accent text-white border-accent'
                    : 'bg-surface text-muted border-border hover:text-foreground hover:border-accent/50'
                }`}
              >
                {l.label}
              </button>
            )
          })}
        </div>
        <p className="text-[11px] text-muted mt-1.5">
          The AI auto-detects and replies in the customer's language.
        </p>
      </div>

      {/* Info box */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-50 border border-blue-200">
        <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
        <div className="text-xs text-blue-800 space-y-1">
          <p><strong>Cost:</strong> Groq is free (up to 14,400 requests/day) · Embeddings run locally — no API cost.</p>
          <p><strong>Cache:</strong> Identical questions skip the LLM entirely for 2 hours.</p>
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-accent/90 active:scale-[0.98] transition-all disabled:opacity-60"
        >
          {saving
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save Configuration'}
        </button>

        {savedAt && (
          <span className="flex items-center gap-1.5 text-xs text-green-700">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Saved {savedAt.toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
    </div>
  )
}
