import { useEffect, useRef, useState } from "react"
import {
  CheckIcon,
  CommandIcon,
  CopyIcon,
  Loader2Icon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  SquareIcon,
} from "lucide-react"

import { Input } from "@/components/ui/input"
import { useActiveOrg } from "@/lib/auth"
import {
  streamChat,
  type ChatMessage,
} from "@/lib/scout-api"

const suggestions = [
  "Why did my last run fail?",
  "Generate a login flow test",
  "What are common test failures?",
]

export default function AiAssistantPage() {
  const org = useActiveOrg()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    })
  }, [messages])

  useEffect(() => {
    return () => controllerRef.current?.abort()
  }, [])

  const send = async (text: string) => {
    if (!org || !text.trim() || streaming) return
    const userMsg: ChatMessage = { role: "user", content: text.trim() }
    const placeholder: ChatMessage = { role: "assistant", content: "" }
    const next = [...messages, userMsg, placeholder]
    setMessages(next)
    setInput("")
    setStreaming(true)

    const controller = new AbortController()
    controllerRef.current = controller

    try {
      await streamChat(
        org.id,
        next.slice(0, -1), // exclude empty placeholder
        {
          onToken: (full) => {
            setMessages((prev) => {
              const copy = prev.slice()
              copy[copy.length - 1] = { role: "assistant", content: full }
              return copy
            })
          },
          onDone: () => {
            setStreaming(false)
          },
        },
        controller.signal,
      )
    } catch (err) {
      if (controller.signal.aborted) {
        setMessages((prev) => {
          const copy = prev.slice()
          const last = copy[copy.length - 1]
          copy[copy.length - 1] = {
            role: "assistant",
            content: (last.content || "") + "\n\n_Stopped._",
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
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">AI Assistant</h1>
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
        <div className="flex flex-1 flex-col gap-4">
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
        </div>
      )}
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
