'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Send, Loader2, MessageSquare, RefreshCw,
  Facebook, Instagram, UserCheck, ArrowLeft,
  CheckCheck,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { format, isToday, isYesterday } from 'date-fns'

type Platform = 'facebook' | 'instagram'

interface SocialContact {
  id: string
  name: string | null
  platform_id: string
  profile_pic: string | null
}

interface SocialConversation {
  id: string
  platform: Platform
  status: string
  needs_human: boolean
  last_message_text: string | null
  last_message_at: string | null
  unread_count: number
  contact: SocialContact
}

interface SocialMessage {
  id: string
  conversation_id: string
  platform_msg_id: string | null
  sender_type: 'customer' | 'agent'
  content_type: string
  content_text: string | null
  media_url: string | null
  status: string
  created_at: string
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(dateStr: string | null): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isToday(d)) return format(d, 'h:mm a')
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'MMM d')
}

function Avatar({ contact, size = 36 }: { contact: SocialContact; size?: number }) {
  const initials = (contact.name ?? contact.platform_id).slice(0, 2).toUpperCase()
  if (contact.profile_pic) {
    return (
      <img
        src={contact.profile_pic}
        alt={contact.name ?? 'Contact'}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
      />
    )
  }
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-semibold shrink-0 select-none"
      style={{ width: size, height: size, fontSize: size * 0.33, background: 'var(--color-accent)' }}
    >
      {initials}
    </div>
  )
}

const PLATFORM_COLOR: Record<Platform, string> = {
  facebook: '#1877f2',
  instagram: '#c13584',
}

const PLATFORM_BG: Record<Platform, string> = {
  facebook: 'rgba(24,119,242,0.08)',
  instagram: 'rgba(193,53,132,0.08)',
}

// ── Single-platform panel ─────────────────────────────────────────────────────

function PlatformPanel({
  platform,
  isVisible,
}: {
  platform: Platform
  isVisible: boolean
}) {
  const [conversations, setConversations] = useState<SocialConversation[]>([])
  const [active, setActive] = useState<SocialConversation | null>(null)
  const [messages, setMessages] = useState<SocialMessage[]>([])
  const [loadingConvs, setLoadingConvs] = useState(true)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [sendText, setSendText] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const convPollRef = useRef<NodeJS.Timeout | null>(null)
  const msgPollRef = useRef<NodeJS.Timeout | null>(null)
  const activeIdRef = useRef<string | null>(null)

  const brandColor = PLATFORM_COLOR[platform]
  const brandBg = PLATFORM_BG[platform]
  const PlatformIcon = platform === 'facebook' ? Facebook : Instagram

  useEffect(() => { activeIdRef.current = active?.id ?? null }, [active])

  // ── Load conversations ────────────────────────────────────────────────────

  const loadConversations = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingConvs(true)
    try {
      const res = await fetch(`/api/social/conversations?platform=${platform}`, { cache: 'no-store' })
      if (res.ok) {
        const data: SocialConversation[] = await res.json()
        setConversations(data)
        if (activeIdRef.current) {
          const updated = data.find((c) => c.id === activeIdRef.current)
          if (updated) setActive(updated)
        }
      }
    } catch { /* silent */ } finally {
      if (!quiet) setLoadingConvs(false)
    }
  }, [platform])

  useEffect(() => {
    loadConversations()
    convPollRef.current = setInterval(() => loadConversations(true), 15_000)
    return () => { if (convPollRef.current) clearInterval(convPollRef.current) }
  }, [loadConversations])

  // ── Load messages ─────────────────────────────────────────────────────────

  const loadMessages = useCallback(async (conversationId: string, quiet = false) => {
    if (!quiet) setLoadingMsgs(true)
    try {
      const res = await fetch(`/api/social/conversations/${conversationId}/messages`, { cache: 'no-store' })
      if (res.ok) {
        const data: SocialMessage[] = await res.json()
        setMessages(data)
        setConversations((prev) =>
          prev.map((c) => c.id === conversationId ? { ...c, unread_count: 0 } : c)
        )
      }
    } catch { /* silent */ } finally {
      if (!quiet) setLoadingMsgs(false)
    }
  }, [])

  useEffect(() => {
    if (msgPollRef.current) clearInterval(msgPollRef.current)
    if (!active) return
    msgPollRef.current = setInterval(() => {
      if (activeIdRef.current) loadMessages(activeIdRef.current, true)
    }, 8_000)
    return () => { if (msgPollRef.current) clearInterval(msgPollRef.current) }
  }, [active?.id, loadMessages]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }
  }, [messages.length])

  const handleSelectConv = (conv: SocialConversation) => {
    if (active?.id === conv.id) return
    setActive(conv)
    setMessages([])
    setSendText('')
    loadMessages(conv.id)
  }

  // ── Send message ──────────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!active || !sendText.trim() || sending) return
    const text = sendText.trim()
    setSendText('')
    setSending(true)

    const tempId = `temp-${Date.now()}`
    const optimistic: SocialMessage = {
      id: tempId,
      conversation_id: active.id,
      platform_msg_id: null,
      sender_type: 'agent',
      content_type: 'text',
      content_text: text,
      media_url: null,
      status: 'sent',
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])

    try {
      const res = await fetch(`/api/social/conversations/${active.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error ?? 'Failed to send message')
        setMessages((prev) => prev.filter((m) => m.id !== tempId))
        setSendText(text)
      } else {
        const saved: SocialMessage = await res.json()
        setMessages((prev) => prev.map((m) => m.id === tempId ? saved : m))
        setConversations((prev) =>
          prev.map((c) => c.id === active.id
            ? { ...c, last_message_text: text, last_message_at: new Date().toISOString() }
            : c)
        )
      }
    } catch {
      toast.error('Send failed — check your connection')
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      setSendText(text)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  // ── Resolve conversation ──────────────────────────────────────────────────

  const handleResolve = async () => {
    if (!active) return
    const newStatus = active.status === 'resolved' ? 'open' : 'resolved'
    try {
      const res = await fetch(`/api/social/conversations/${active.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        setActive((prev) => prev ? { ...prev, status: newStatus } : prev)
        setConversations((prev) =>
          prev.map((c) => c.id === active.id ? { ...c, status: newStatus } : c)
        )
        toast.success(newStatus === 'resolved' ? 'Conversation resolved' : 'Conversation reopened')
      }
    } catch { toast.error('Failed to update status') }
  }

  const hasActive = !!active

  return (
    <div className={cn('flex h-full min-h-0', !isVisible && 'hidden')}>
      {/* ── Left panel: Conversation list ─────────────────────────────────── */}
      <div className={cn(
        'flex flex-col border-r border-border min-h-0 bg-background',
        'w-full lg:w-[300px] lg:flex-none',
        hasActive ? 'hidden lg:flex' : 'flex',
      )}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <PlatformIcon className="size-5 shrink-0" style={{ color: brandColor }} />
          <h2 className="text-sm font-semibold text-foreground flex-1 capitalize">
            {platform} Chats
          </h2>
          <button
            onClick={() => loadConversations()}
            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
            title="Refresh conversations"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {loadingConvs ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-5 animate-spin" style={{ color: brandColor }} />
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div
                className="flex size-14 items-center justify-center rounded-full mb-4"
                style={{ background: brandBg }}
              >
                <MessageSquare className="size-6" style={{ color: brandColor }} />
              </div>
              <p className="text-sm font-medium text-foreground">No messages yet</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Messages will appear here once someone DMs your{' '}
                {platform === 'facebook' ? 'Facebook Page' : 'Instagram account'}.
              </p>
            </div>
          ) : (
            conversations.map((conv, i) => (
              <button
                key={conv.id}
                onClick={() => handleSelectConv(conv)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 min-h-[64px] text-left border-b border-border/50 transition-colors hover:bg-surface-hover tap-press animate-list-in',
                  active?.id === conv.id && 'bg-accent-light border-l-[3px]',
                )}
                style={{
                  ...(active?.id === conv.id ? { borderLeftColor: brandColor } : {}),
                  animationDelay: `${Math.min(i, 12) * 30}ms`,
                }}
              >
                <div className="relative shrink-0">
                  <Avatar contact={conv.contact} size={40} />
                  <span
                    className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-background flex items-center justify-center"
                    style={{ background: brandColor }}
                  >
                    <PlatformIcon className="size-2 text-white" />
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm font-medium text-foreground truncate">
                      {conv.contact.name ?? conv.contact.platform_id}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatTime(conv.last_message_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <p className="text-xs text-muted-foreground truncate flex-1">
                      {conv.last_message_text ?? 'No messages yet'}
                    </p>
                    {conv.unread_count > 0 && (
                      <span
                        className="flex min-w-[18px] h-[18px] items-center justify-center rounded-full text-[10px] font-bold text-white px-1 shrink-0"
                        style={{ backgroundColor: brandColor }}
                      >
                        {conv.unread_count > 99 ? '99+' : conv.unread_count}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {conv.needs_human && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                        <UserCheck className="size-2.5" /> Human needed
                      </span>
                    )}
                    {conv.status === 'resolved' && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                        <CheckCheck className="size-2.5" /> Resolved
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Right panel: Message thread ───────────────────────────────────── */}
      <div className={cn(
        'flex flex-col flex-1 min-h-0 min-w-0 bg-background',
        hasActive ? 'flex' : 'hidden lg:flex',
      )}>
        {!active ? (
          <div className="flex flex-col items-center justify-center flex-1 text-center px-8">
            <div
              className="flex size-20 items-center justify-center rounded-full mb-4"
              style={{ background: brandBg }}
            >
              <PlatformIcon className="size-10" style={{ color: brandColor }} />
            </div>
            <p className="text-base font-semibold text-foreground">
              {platform === 'facebook' ? 'Facebook' : 'Instagram'} Chats
            </p>
            <p className="text-sm text-muted-foreground mt-2 max-w-xs leading-relaxed">
              Select a conversation from the list to view and reply to messages.
            </p>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div className="flex items-center gap-3 px-3 sm:px-4 py-3 border-b border-border shrink-0 bg-background">
              <button
                onClick={() => setActive(null)}
                className="lg:hidden flex items-center justify-center size-9 -ml-1 rounded-full hover:bg-surface-hover transition-colors text-muted-foreground tap-press-sm"
                aria-label="Back to conversations"
              >
                <ArrowLeft className="size-5" />
              </button>

              <Avatar contact={active.contact} size={38} />

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">
                  {active.contact.name ?? active.contact.platform_id}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground capitalize flex items-center gap-1">
                    <PlatformIcon className="size-3" style={{ color: brandColor }} />
                    {platform}
                  </span>
                  {active.needs_human && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-600">
                      <UserCheck className="size-3" /> Needs Human
                    </span>
                  )}
                  {active.status === 'resolved' && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-green-600">
                      <CheckCheck className="size-3" /> Resolved
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {active.needs_human && (
                  <span className="hidden md:inline-flex items-center gap-1.5 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2.5 py-1">
                    <UserCheck className="size-3" />
                    AI Paused
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResolve}
                  className={cn(
                    'h-8 text-xs border-border shrink-0',
                    active.status === 'resolved'
                      ? 'text-green-700 border-green-200 bg-green-50 hover:bg-green-100'
                      : 'text-foreground hover:bg-surface-hover',
                  )}
                >
                  <CheckCheck className="size-3.5 mr-1" />
                  <span className="hidden sm:inline">
                    {active.status === 'resolved' ? 'Reopen' : 'Resolve'}
                  </span>
                </Button>
              </div>
            </div>

            {/* Human-needs alert bar */}
            {active.needs_human && (
              <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-700 shrink-0">
                <UserCheck className="size-3.5 shrink-0" />
                <span>AI chatbot is paused — you are replying as a human agent.</span>
              </div>
            )}

            {/* Message bubbles */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-2">
              {loadingMsgs ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-5 animate-spin" style={{ color: brandColor }} />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                  No messages yet
                </div>
              ) : (
                messages.map((msg) => {
                  const isAgent = msg.sender_type === 'agent'
                  const isTemp = msg.id.startsWith('temp-')
                  return (
                    <div key={msg.id} className={cn('flex', isAgent ? 'justify-end' : 'justify-start')}>
                      {!isAgent && (
                        <Avatar contact={active.contact} size={28} />
                      )}
                      <div
                        className={cn(
                          'max-w-[75%] sm:max-w-[65%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm',
                          !isAgent && 'ml-2',
                          isAgent
                            ? 'text-white rounded-br-none'
                            : 'bg-surface-light text-foreground rounded-bl-none border border-border/50',
                          isTemp && 'opacity-60',
                        )}
                        style={isAgent ? { backgroundColor: brandColor } : {}}
                      >
                        {msg.content_text && (
                          <p className="whitespace-pre-wrap break-words leading-relaxed">
                            {msg.content_text}
                          </p>
                        )}
                        {msg.media_url && (
                          <a
                            href={msg.media_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-xs underline opacity-80 mt-1"
                          >
                            📎 View attachment
                          </a>
                        )}
                        {!msg.content_text && !msg.media_url && (
                          <p className="text-xs opacity-60 italic">
                            [{msg.content_type} message]
                          </p>
                        )}
                        <p className={cn(
                          'text-[10px] mt-1 select-none',
                          isAgent ? 'text-white/60 text-right' : 'text-muted-foreground',
                        )}>
                          {format(new Date(msg.created_at), 'h:mm a')}
                          {isAgent && isTemp && ' · Sending…'}
                          {isAgent && !isTemp && msg.status === 'sent' && ' · Sent'}
                        </p>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Composer */}
            <div className="border-t border-border bg-background px-3 sm:px-4 py-3 shrink-0">
              <div className="flex gap-2 items-end">
                <Input
                  placeholder={`Message on ${platform === 'facebook' ? 'Facebook' : 'Instagram'}…`}
                  value={sendText}
                  onChange={(e) => setSendText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="flex-1 min-h-[40px] resize-none"
                  disabled={sending}
                  autoComplete="off"
                />
                <Button
                  onClick={handleSend}
                  disabled={!sendText.trim() || sending}
                  className="text-white shrink-0 h-10 w-10 p-0"
                  style={{ backgroundColor: brandColor }}
                  aria-label="Send message"
                >
                  {sending
                    ? <Loader2 className="size-4 animate-spin" />
                    : <Send className="size-4" />
                  }
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5 text-right">
                Press <kbd className="font-mono bg-surface-light rounded px-1">Enter</kbd> to send
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main Component (combined with tabs) ──────────────────────────────────────

export function SocialInbox({ platform }: { platform?: Platform }) {
  // If a specific platform is forced (legacy usage), just show that panel
  const [activeTab, setActiveTab] = useState<Platform>(platform ?? 'instagram')

  // When a forced platform prop is given, keep tab in sync
  useEffect(() => {
    if (platform) setActiveTab(platform)
  }, [platform])

  const igColor = PLATFORM_COLOR.instagram
  const fbColor = PLATFORM_COLOR.facebook

  return (
    // Mobile: use the full viewport below the top bar now that the fixed bottom
    // navigation has been removed. Desktop (md+) keeps the original height.
    <div className="-m-3.5 sm:-m-6 flex flex-col h-[calc(100dvh-3.5rem-env(safe-area-inset-bottom))] md:h-[calc(100dvh-3.5rem)] min-h-0 overflow-hidden">

      {/* ── Mobile segmented channel control ─────────────────────────────── */}
      {!platform && (
        <div className="md:hidden shrink-0 border-b border-border bg-background px-3 py-2">
          <div className="seg-row">
            <button
              onClick={() => setActiveTab('instagram')}
              data-active={activeTab === 'instagram'}
              className="seg-pill tap-press-sm flex items-center justify-center gap-1.5"
              style={{ flex: '1 1 0', color: activeTab === 'instagram' ? igColor : undefined }}
            >
              <Instagram className="size-4" />
              <span>Instagram</span>
            </button>
            <button
              onClick={() => setActiveTab('facebook')}
              data-active={activeTab === 'facebook'}
              className="seg-pill tap-press-sm flex items-center justify-center gap-1.5"
              style={{ flex: '1 1 0', color: activeTab === 'facebook' ? fbColor : undefined }}
            >
              <Facebook className="size-4" />
              <span>Facebook</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Tab bar (desktop) ────────────────────────────────────────────── */}
      {!platform && (
        <div className="hidden md:flex shrink-0 border-b border-border bg-background">
          {/* Instagram tab */}
          <button
            id="social-inbox-tab-instagram"
            onClick={() => setActiveTab('instagram')}
            className={cn(
              'flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === 'instagram'
                ? 'border-[#c13584] text-[#c13584]'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-surface-hover',
            )}
          >
            <Instagram className="size-4" />
            <span>Instagram</span>
          </button>

          {/* Facebook tab */}
          <button
            id="social-inbox-tab-facebook"
            onClick={() => setActiveTab('facebook')}
            className={cn(
              'flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === 'facebook'
                ? 'border-[#1877f2] text-[#1877f2]'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-surface-hover',
            )}
          >
            <Facebook className="size-4" />
            <span>Facebook</span>
          </button>

          {/* Spacer / platform dot indicator */}
          <div className="flex-1" />
          <div className="flex items-center gap-3 pr-4">
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: activeTab === 'instagram' ? igColor : fbColor }}
              />
              {activeTab === 'instagram' ? 'Instagram DMs' : 'Facebook Messenger'}
            </span>
          </div>
        </div>
      )}

      {/* ── Panel area ───────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 relative">
        <PlatformPanel platform="instagram" isVisible={activeTab === 'instagram'} />
        <PlatformPanel platform="facebook" isVisible={activeTab === 'facebook'} />
      </div>
    </div>
  )
}
