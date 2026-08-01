'use client'

import { useState } from 'react'
import {
  Code2, RotateCcw, Save, Loader2, CheckCircle2, Info, AlertCircle,
} from 'lucide-react'
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/ai-agent/system-prompt'

const VARIABLES = [
  { token: '{{AGENT_NAME}}',          desc: 'The agent name set in Config' },
  { token: '{{COMPANY_NAME}}',        desc: 'Same as agent name (editable inline)' },
  { token: '{{COMPANY_CONTEXT}}',     desc: 'Injected knowledge from Config' },
  { token: '{{RETRIEVED_CHUNKS}}',    desc: 'Top-3 RAG chunks from the knowledge base' },
  { token: '{{CONVERSATION_HISTORY}}',desc: 'Last 5 messages for context' },
  { token: '{{CUSTOMER_MESSAGE}}',    desc: "The customer's current message" },
]

interface Props {
  value: string
  onChange: (v: string) => void
  onSave: () => Promise<void>
  saving: boolean
  savedAt: Date | null
}

export function SystemPromptEditor({ value, onChange, onSave, saving, savedAt }: Props) {
  const [confirmReset, setConfirmReset] = useState(false)

  const handleReset = () => {
    if (!confirmReset) { setConfirmReset(true); return }
    onChange(DEFAULT_SYSTEM_PROMPT)
    setConfirmReset(false)
  }

  // Highlight {{PLACEHOLDER}} tokens in the character count line
  const tokenMatches = (value.match(/\{\{[A-Z_]+\}\}/g) ?? []).length
  const usedTokens = new Set(value.match(/\{\{[A-Z_]+\}\}/g) ?? [])
  const missingRequired = ['{{RETRIEVED_CHUNKS}}', '{{CUSTOMER_MESSAGE}}'].filter(
    (t) => !usedTokens.has(t),
  )

  return (
    <div className="space-y-5">

      {/* Header */}
      <div>
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Code2 className="w-4 h-4 text-accent" />
          System Prompt
        </h3>
        <p className="text-xs text-muted mt-0.5">
          Controls the AI's personality, rules, and output format. Use{' '}
          <code className="font-mono bg-surface-hover px-1 rounded text-accent text-[11px]">{'{{PLACEHOLDER}}'}</code>{' '}
          tokens — they're filled in automatically at runtime.
        </p>
      </div>

      {/* Variable reference */}
      <div className="p-3 rounded-xl bg-surface border border-border space-y-2">
        <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">Available Tokens</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {VARIABLES.map(v => (
            <div key={v.token} className="flex items-start gap-2">
              <code
                className={`text-[11px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
                  usedTokens.has(v.token)
                    ? 'bg-green-100 text-green-700'
                    : 'bg-surface-hover text-muted'
                }`}
              >
                {v.token}
              </code>
              <span className="text-[11px] text-muted leading-tight mt-0.5">{v.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Missing token warning */}
      {missingRequired.length > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-yellow-50 border border-yellow-200 text-xs text-yellow-800">
          <AlertCircle className="w-4 h-4 shrink-0 text-yellow-600 mt-0.5" />
          <span>
            Missing required token{missingRequired.length > 1 ? 's' : ''}:{' '}
            {missingRequired.map(t => (
              <code key={t} className="font-mono bg-yellow-100 px-1 rounded mr-1">{t}</code>
            ))}
            — the AI will not receive this data without it.
          </span>
        </div>
      )}

      {/* Editor */}
      <div className="relative">
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={22}
          spellCheck={false}
          className="w-full px-4 py-3 rounded-xl border border-border bg-gray-950 text-green-300 text-xs font-mono leading-relaxed placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors resize-y"
          style={{ tabSize: 2 }}
        />
        {/* Overlay badge */}
        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          <span className="text-[10px] text-gray-500 bg-gray-900 px-2 py-0.5 rounded font-mono">
            {value.length.toLocaleString()} chars · ~{Math.ceil(value.length / 4)} tokens · {tokenMatches} placeholders
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-800">
        <Info className="w-4 h-4 shrink-0 text-blue-600 mt-0.5" />
        <span>
          Keep the prompt under <strong>1000 tokens (~4000 chars)</strong> to leave room for retrieved knowledge
          and conversation history within the LLM's context window.
          Currently using <strong>{Math.round(value.length / 4)} tokens</strong>.
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-accent/90 active:scale-[0.98] transition-all disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : 'Save Prompt'}
        </button>

        <button
          onClick={handleReset}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
            confirmReset
              ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
              : 'bg-surface text-muted border-border hover:text-foreground hover:bg-surface-hover'
          }`}
        >
          <RotateCcw className="w-4 h-4" />
          {confirmReset ? 'Confirm Reset to Default' : 'Reset to Default'}
        </button>

        {confirmReset && (
          <button
            onClick={() => setConfirmReset(false)}
            className="text-xs text-muted hover:text-foreground px-2 py-1 rounded-lg transition-colors"
          >
            Cancel
          </button>
        )}

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
