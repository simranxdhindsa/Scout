'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Bot, User, Loader2, Sparkles, Copy, Check } from 'lucide-react'
import { getAuthToken } from '@/lib/auth'
import s from './ChatBot.module.css'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

interface ChatBotProps {
  orgId: string
  systemPrompt?: string
  placeholder?: string
}

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

export function ChatBot({ orgId, placeholder = 'Ask about test failures, generate tests…' }: ChatBotProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const idCounter = useRef(0)

  const nextId = () => String(idCounter.current++)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    setInput('')

    const userMsg: Message = { id: nextId(), role: 'user', content: text }
    const assistantId = nextId()
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', streaming: true }

    setMessages((prev) => [...prev, userMsg, assistantMsg])
    setIsStreaming(true)

    const token = getAuthToken()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(`${BASE_URL}/api/v1/orgs/${orgId}/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: [
            ...messages.map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: text },
          ],
        }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) throw new Error('Stream failed')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') break
          if (data.startsWith('[ERROR]')) {
            accumulated += '\n\n⚠️ ' + data.slice(8)
            break
          }
          accumulated += data
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: accumulated } : m
            )
          )
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: '⚠️ Failed to get response. Please try again.', streaming: false }
              : m
          )
        )
      }
    } finally {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, streaming: false } : m
        )
      )
      setIsStreaming(false)
      abortRef.current = null
    }
  }, [input, isStreaming, messages, orgId])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const copyMessage = (id: string, content: string) => {
    navigator.clipboard.writeText(content)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const stop = () => {
    abortRef.current?.abort()
    setIsStreaming(false)
  }

  return (
    <div className={s.chatShell}>
      {/* Messages */}
      <div className={s.messages}>
        {messages.length === 0 && (
          <div className={s.emptyState}>
            <div className={s.emptyIcon}>
              <Sparkles size={22} />
            </div>
            <div>
              <p className={s.emptyTitle}>Scout AI</p>
              <p className={s.emptySub}>
                Ask me to analyze test failures, generate Playwright tests, or explain run results.
              </p>
            </div>
            <div className={s.quickActions}>
              {[
                'Why did my last run fail?',
                'Generate a login flow test',
                'What are common test failures?',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setInput(suggestion)}
                  className={s.quickBtn}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`${s.messageRow} ${msg.role === 'user' ? s.messageRowUser : ''}`}
          >
            {/* Avatar */}
            <div className={`${s.avatar} ${msg.role === 'user' ? s.avatarUser : s.avatarBot}`}>
              {msg.role === 'user' ? <User size={13} /> : <Bot size={13} />}
            </div>

            {/* Bubble */}
            <div className={`${s.bubble} ${msg.role === 'user' ? s.bubbleUser : s.bubbleBot}`}>
              {msg.streaming && msg.content === '' ? (
                <div className={s.typingDots}>
                  <span /><span /><span />
                </div>
              ) : (
                <pre className={s.bubbleText}>{msg.content}</pre>
              )}
              {msg.streaming && msg.content !== '' && (
                <span className={s.cursor} />
              )}

              {/* Copy button */}
              {!msg.streaming && msg.role === 'assistant' && (
                <button
                  onClick={() => copyMessage(msg.id, msg.content)}
                  className={s.copyBtn}
                >
                  {copiedId === msg.id ? <Check size={11} style={{ color: 'var(--passed)' }} /> : <Copy size={11} />}
                </button>
              )}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className={s.inputArea}>
        <div className={s.inputWrap}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            disabled={isStreaming}
            className={s.textarea}
            style={{ maxHeight: '120px', overflowY: 'auto' }}
            onInput={(e) => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`
            }}
          />
          {isStreaming ? (
            <button onClick={stop} className={s.stopBtn} title="Stop">
              <span className={s.stopIcon} />
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!input.trim()}
              className={`${s.sendBtn} ${input.trim() ? s.sendBtnActive : s.sendBtnDisabled}`}
            >
              <Send size={13} />
            </button>
          )}
        </div>
        <p className={s.inputHint}>Press Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  )
}
