import { useEffect, useRef, useState } from "react"
import {
  CheckIcon,
  CommandIcon,
  CopyIcon,
  Loader2Icon,
  PanelLeftIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  SquareIcon,
  TrashIcon,
} from "lucide-react"

import { Input } from "@/components/ui/input"
import { ScoutEmptyState } from "@/components/ScoutEmptyState"
import { useActiveOrg } from "@/lib/auth"
import {
  chatHistoryApi,
  streamChat,
  type ChatMessage,
  type ChatSession,
} from "@/lib/scout-api"

const suggestions = [
  "Why did my last run fail?",
  "Generate a login flow test",
  "What are common test failures?",
]

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  return `${Math.floor(diffDays / 30)}mo ago`
}

export default function AiAssistantPage() {
  const org = useActiveOrg()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Load sessions on mount / org change
  useEffect(() => {
    if (!org) return
    chatHistoryApi.listSessions(org.id).then(setSessions).catch(() => {})
  }, [org])

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    })
  }, [messages])

  useEffect(() => {
    return () => controllerRef.current?.abort()
  }, [])

  const selectSession = async (session: ChatSession) => {
    if (!org) return
    setActiveSessionId(session.id)
    try {
      const historyMsgs = await chatHistoryApi.getMessages(org.id, session.id)
      setMessages(
        historyMsgs
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      )
    } catch {
      setMessages([])
    }
  }

  const pendingSessionRef = useRef<Promise<ChatSession> | null>(null)

  const newChat = async () => {
    if (!org) return
    try {
      const promise = chatHistoryApi.createSession(org.id)
      pendingSessionRef.current = promise
      const session = await promise
      setSessions((prev) => [session, ...prev])
      setActiveSessionId(session.id)
      setMessages([])
    } catch {
      setActiveSessionId(null)
      setMessages([])
    } finally {
      pendingSessionRef.current = null
    }
  }

  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!org) return
    try {
      await chatHistoryApi.deleteSession(org.id, sessionId)
      setSessions((prev) => prev.filter((s) => s.id !== sessionId))
      if (activeSessionId === sessionId) {
        setActiveSessionId(null)
        setMessages([])
      }
    } catch {
      // ignore
    }
  }

  const send = async (text: string) => {
    if (!org || !text.trim() || streaming) return
    const userMsg: ChatMessage = { role: "user", content: text.trim() }
    const placeholder: ChatMessage = { role: "assistant", content: "" }
    const next = [...messages, userMsg, placeholder]
    setMessages(next)
    setInput("")
    setStreaming(true)

    // Ensure we have an active session — reuse newChat()'s in-flight promise if present
    let sessionId = activeSessionId
    const isFirstMessage = messages.length === 0
    if (!sessionId) {
      try {
        const session = pendingSessionRef.current
          ? await pendingSessionRef.current
          : await (async () => {
              const p = chatHistoryApi.createSession(org.id)
              pendingSessionRef.current = p
              const s = await p
              pendingSessionRef.current = null
              setSessions((prev) => [s, ...prev])
              setActiveSessionId(s.id)
              return s
            })()
        sessionId = session.id
      } catch {
        // proceed without persistence
      }
    }

    // Save user message
    if (sessionId) {
      chatHistoryApi.addMessage(org.id, sessionId, "user", text.trim()).catch(() => {})
      if (isFirstMessage) {
        chatHistoryApi
          .updateTitle(org.id, sessionId, text.trim().slice(0, 50))
          .then(() => {
            setSessions((prev) =>
              prev.map((s) =>
                s.id === sessionId
                  ? { ...s, title: text.trim().slice(0, 50) }
                  : s,
              ),
            )
          })
          .catch(() => {})
      }
    }

    const controller = new AbortController()
    controllerRef.current = controller

    try {
      let finalResponse = ""
      await streamChat(
        org.id,
        next.slice(0, -1), // exclude empty placeholder
        {
          onToken: (full) => {
            finalResponse = full
            setMessages((prev) => {
              const copy = prev.slice()
              copy[copy.length - 1] = { role: "assistant", content: full }
              return copy
            })
          },
          onDone: (full) => {
            finalResponse = full
            setStreaming(false)
            if (sessionId && full) {
              chatHistoryApi
                .addMessage(org.id, sessionId, "assistant", full)
                .catch(() => {})
            }
          },
        },
        controller.signal,
      )
      // onDone may not fire if stream ended without [DONE], save what we have
      if (sessionId && finalResponse && !controller.signal.aborted) {
        // already saved in onDone; nothing extra needed
      }
    } catch (err) {
      if (controller.signal.aborted) {
        setMessages((prev) => {
          const copy = prev.slice()
          const last = copy[copy.length - 1]
          const stoppedContent = (last.content || "") + "\n\n_Stopped._"
          if (sessionId) {
            chatHistoryApi
              .addMessage(org.id, sessionId, "assistant", stoppedContent)
              .catch(() => {})
          }
          copy[copy.length - 1] = {
            role: "assistant",
            content: stoppedContent,
          }
          return copy
        })
      } else {
        const msg = (err as Error).message ?? "Something went wrong"
        setMessages((prev) => {
          const copy = prev.slice()
          copy[copy.length - 1] = {
            role: "assistant",
            content: `⚠️  ${msg}`,
          }
          return copy
        })
      }
    } finally {
      setStreaming(false)
      controllerRef.current = null
    }
  }

  const stop = () => {
    controllerRef.current?.abort()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  const hasMessages = messages.length > 0

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="text-muted-foreground hover:text-foreground inline-flex size-8 items-center justify-center rounded"
            aria-label="Toggle sidebar"
          >
            <PanelLeftIcon className="size-4" />
          </button>
          <h1 className="text-3xl font-semibold tracking-tight">AI Assistant</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              placeholder="Search..."
              className="bg-muted/60 w-64 pl-9 pr-14"
            />
            <kbd className="bg-muted text-muted-foreground absolute top-1/2 right-2 -translate-y-1/2 inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px]">
              <CommandIcon className="size-2.5" />K
            </kbd>
          </div>
        </div>
      </div>

      {/* Two-panel body */}
      <div className="flex flex-1 gap-0 overflow-hidden">
        {/* Sidebar */}
        {sidebarOpen && (
          <div className="border-border/40 flex w-60 shrink-0 flex-col border-r">
            <div className="p-2">
              <button
                type="button"
                onClick={newChat}
                disabled={!org}
                className="bg-muted/40 ring-border/40 hover:bg-accent flex w-full items-center gap-2 rounded px-3 py-2 text-sm ring-1 disabled:opacity-50"
              >
                <PlusIcon className="size-4" />
                New chat
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-2">
              {sessions.length === 0 ? (
                <ScoutEmptyState message="No chats yet" />
              ) : (
                sessions.map((session) => (
                  <div
                    key={session.id}
                    onClick={() => selectSession(session)}
                    className={`group flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm ${
                      activeSessionId === session.id
                        ? "bg-muted/60"
                        : "hover:bg-muted/40"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium leading-tight">
                        {session.title || "New chat"}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {formatRelativeDate(session.updated_at)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => deleteSession(session.id, e)}
                      className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label="Delete session"
                    >
                      <TrashIcon className="size-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Chat panel */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {!hasMessages ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
              <div className="bg-primary/20 ring-primary/30 inline-flex size-14 items-center justify-center rounded-full ring-1">
                <SparklesIcon className="text-primary size-6" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Scout AI</h2>
                <p className="text-muted-foreground mt-1 max-w-md text-sm">
                  Ask me to analyze test failures, generate Playwright tests, or
                  explain run results.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    disabled={!org || streaming}
                    className="bg-muted/40 ring-border/40 hover:bg-accent rounded-full px-4 py-2 text-sm ring-1 disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <ChatComposer
                input={input}
                setInput={setInput}
                onKeyDown={onKeyDown}
                onSend={() => send(input)}
                onStop={stop}
                streaming={streaming}
                disabled={!org}
              />
            </div>
          ) : (
            <>
              <div
                ref={scrollRef}
                className="ring-border/40 bg-card/30 flex max-h-[60vh] flex-1 flex-col gap-4 overflow-y-auto p-4 ring-1"
              >
                {messages.map((m, i) => (
                  <MessageBubble
                    key={i}
                    message={m}
                    streaming={
                      streaming &&
                      i === messages.length - 1 &&
                      m.role === "assistant"
                    }
                  />
                ))}
              </div>
              <ChatComposer
                input={input}
                setInput={setInput}
                onKeyDown={onKeyDown}
                onSend={() => send(input)}
                onStop={stop}
                streaming={streaming}
                disabled={!org}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ChatComposer({
  input,
  setInput,
  onKeyDown,
  onSend,
  onStop,
  streaming,
  disabled,
}: {
  input: string
  setInput: (v: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onSend: () => void
  onStop: () => void
  streaming: boolean
  disabled: boolean
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
      <div className="bg-muted/40 ring-border/40 flex items-center gap-2 p-3 ring-1">
        <textarea
          rows={1}
          value={input}
          disabled={disabled}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about test failures, generate tests..."
          className="placeholder:text-muted-foreground flex-1 resize-none bg-transparent text-left text-sm outline-none disabled:opacity-50"
        />
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            className="bg-rose-500/10 ring-rose-500/30 hover:bg-rose-500/20 text-rose-300 inline-flex size-9 items-center justify-center ring-1"
            aria-label="Stop"
          >
            <SquareIcon className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={disabled || !input.trim()}
            className="bg-muted/60 ring-border/40 hover:bg-accent inline-flex size-9 items-center justify-center ring-1 disabled:opacity-50"
            aria-label="Send"
          >
            <SendIcon className="size-4" />
          </button>
        )}
      </div>
      <p className="text-muted-foreground text-center text-xs">
        Press Enter to send · Shift+Enter for new line
      </p>
    </div>
  )
}

function MessageBubble({
  message,
  streaming,
}: {
  message: ChatMessage
  streaming: boolean
}) {
  const [copied, setCopied] = useState(false)
  const isUser = message.role === "user"

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  const showTyping =
    message.role === "assistant" && streaming && message.content.length === 0

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} gap-2`}
    >
      <div
        className={`group ring-border/40 max-w-[80%] px-4 py-3 text-sm ring-1 ${
          isUser ? "bg-primary/15 text-foreground" : "bg-muted/40"
        }`}
      >
        {showTyping ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2Icon className="size-3.5 animate-spin" />
            <span className="text-muted-foreground">Thinking…</span>
          </span>
        ) : (
          <div className="whitespace-pre-wrap">
            {message.content}
            {streaming && !isUser ? (
              <span className="bg-foreground ml-0.5 inline-block h-3.5 w-1 animate-pulse align-middle" />
            ) : null}
          </div>
        )}
        {!isUser && message.content && !streaming ? (
          <button
            type="button"
            onClick={handleCopy}
            className="text-muted-foreground hover:text-foreground mt-2 inline-flex items-center gap-1 text-xs"
            aria-label="Copy message"
          >
            {copied ? (
              <>
                <CheckIcon className="size-3" />
                Copied
              </>
            ) : (
              <>
                <CopyIcon className="size-3" />
                Copy
              </>
            )}
          </button>
        ) : null}
      </div>
    </div>
  )
}
