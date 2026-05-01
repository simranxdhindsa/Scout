import { useCallback, useEffect, useRef, useState } from "react"
import { CheckCircle, FileText, Loader2, Play, UploadCloud, X, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface UploadedFile {
  file: File
  id: string
}

type RunStatus = "idle" | "uploading" | "running" | "done" | "failed" | "stopped"

const BACKEND = "http://localhost:4000"

// Build regex dynamically so the ESC char doesn't trigger no-control-regex
const ANSI_RE = new RegExp(
  String.fromCharCode(27) + "(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])",
  "g"
)
const stripAnsi = (s: string) => s.replace(ANSI_RE, "")

export function Dropzone() {
  const [isDragging, setIsDragging] = useState(false)
  const [files, setFiles] = useState<UploadedFile[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const [runStatus, setRunStatus] = useState<RunStatus>("idle")
  const [outputLines, setOutputLines] = useState<string[]>([])
  const [exitCode, setExitCode] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const terminalRef = useRef<HTMLDivElement>(null)
  const offsetRef = useRef(0)

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [outputLines])

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const addFiles = useCallback((incoming: FileList | null) => {
    if (!incoming) return
    const next: UploadedFile[] = Array.from(incoming).map((file) => ({
      file,
      id: `${file.name}-${file.lastModified}-${Math.random()}`,
    }))
    setFiles((prev) => [...prev, ...next])
  }, [])

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const onDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false)
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    addFiles(e.dataTransfer.files)
  }

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function startPolling() {
    offsetRef.current = 0
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND}/api/run/output?offset=${offsetRef.current}`)
        if (!res.ok) return
        const data = await res.json()
        if (data.lines?.length > 0) {
          setOutputLines((prev) => [...prev, ...data.lines.map(stripAnsi)])
          offsetRef.current = data.totalLines
        }
        if (data.status === "done" || data.status === "failed" || data.status === "stopped") {
          if (pollRef.current) clearInterval(pollRef.current)
          setRunStatus(data.status as RunStatus)
          setExitCode(data.exitCode ?? 0)
        }
      } catch {
        // keep polling on transient network errors
      }
    }, 500)
  }

  async function handleSubmit() {
    if (files.length === 0) return
    const fileToUpload = files[0].file

    setUploadError(null)
    setOutputLines([])
    setRunStatus("uploading")

    const formData = new FormData()
    formData.append("file", fileToUpload)

    try {
      const res = await fetch(`${BACKEND}/api/upload`, {
        method: "POST",
        body: formData,
      })
      if (!res.ok) {
        const text = await res.text()
        setUploadError(text.trim())
        setRunStatus("idle")
        return
      }
      setRunStatus("running")
      startPolling()
    } catch {
      setUploadError("Cannot connect to the backend. Is the Go server running?")
      setRunStatus("idle")
    }
  }

  function handleReset() {
    if (pollRef.current) clearInterval(pollRef.current)
    setRunStatus("idle")
    setOutputLines([])
    setExitCode(0)
    setUploadError(null)
    setFiles([])
  }

  const isRunning = runStatus === "uploading" || runStatus === "running"
  const isDone = runStatus === "done" || runStatus === "failed" || runStatus === "stopped"

  return (
    <div className="space-y-4">
      <div
        role="button"
        tabIndex={0}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-12 text-center transition-colors",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border bg-muted/40 hover:border-primary/50 hover:bg-muted/60"
        )}
      >
        <div className={cn("rounded-full p-3 transition-colors", isDragging ? "bg-primary/10" : "bg-muted")}>
          <UploadCloud className={cn("h-7 w-7 transition-colors", isDragging ? "text-primary" : "text-muted-foreground")} />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">
            {isDragging ? "Drop files here" : "Drag & drop files here"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">or click to browse from your computer</p>
        </div>
        <Button variant="outline" size="sm" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
          Browse files
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map(({ file, id }) => (
            <li
              key={id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
              </div>
              <button
                onClick={() => removeFile(id)}
                disabled={isRunning}
                className="ml-auto shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                aria-label="Remove file"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {uploadError && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {uploadError}
        </p>
      )}

      {files.length > 0 && !isDone && (
        <Button onClick={handleSubmit} disabled={isRunning} className="w-full">
          {isRunning ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {runStatus === "uploading" ? "Uploading…" : "Running tests…"}
            </>
          ) : (
            <>
              <Play className="mr-2 h-4 w-4" />
              Run Tests
            </>
          )}
        </Button>
      )}

      {(isRunning || isDone) && (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="flex items-center justify-between border-b border-border bg-muted/60 px-4 py-2">
            <span className="text-xs font-medium text-muted-foreground">Output</span>
            {isDone && (
              <span
                className={cn(
                  "flex items-center gap-1.5 text-xs font-medium",
                  exitCode === 0
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                )}
              >
                {exitCode === 0 ? (
                  <><CheckCircle className="h-3.5 w-3.5" /> Passed</>
                ) : (
                  <><XCircle className="h-3.5 w-3.5" /> Failed (exit {exitCode})</>
                )}
              </span>
            )}
          </div>
          <div ref={terminalRef} className="h-96 overflow-y-auto bg-zinc-950 p-4">
            <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-zinc-200">
              {outputLines.join("\n")}
              {isRunning && <span className="animate-pulse">▋</span>}
            </pre>
          </div>
        </div>
      )}

      {isDone && (
        <Button variant="outline" onClick={handleReset} className="w-full">
          Reset
        </Button>
      )}
    </div>
  )
}
