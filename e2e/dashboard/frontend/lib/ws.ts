'use client'

import { getAuthToken } from './auth'

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8080'

// ── Types ─────────────────────────────────────────────────────────────────────

export type StreamMessageType = 'stdout' | 'stderr' | 'status' | 'done' | 'error' | 'data'

export interface StreamMessage {
  type: StreamMessageType
  payload: string
  run_id: string
  time: string
}

export type StreamHandler = (msg: StreamMessage) => void

// ── RunStream ─────────────────────────────────────────────────────────────────

/**
 * RunStream opens a WebSocket connection to the Scout backend and emits
 * structured StreamMessage events to registered handlers.
 *
 * Usage:
 *   const stream = new RunStream(orgId, runId)
 *   stream.onMessage((msg) => console.log(msg))
 *   stream.connect()
 *   // later:
 *   stream.disconnect()
 */
export class RunStream {
  private ws: WebSocket | null = null
  private handlers: StreamHandler[] = []
  private reconnectAttempts = 0
  private maxReconnects = 3
  private reconnectDelay = 2000
  private orgId: string
  private runId: string
  private stopped = false

  constructor(orgId: string, runId: string) {
    this.orgId = orgId
    this.runId = runId
  }

  // Register a message handler
  onMessage(handler: StreamHandler): this {
    this.handlers.push(handler)
    return this
  }

  // Open the WebSocket connection
  connect(): this {
    if (this.stopped) return this

    const token = getAuthToken()
    const url = `${WS_BASE}/api/v1/orgs/${this.orgId}/runs/${this.runId}/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`

    try {
      this.ws = new WebSocket(url)
    } catch {
      this.emit({ type: 'error', payload: 'failed to open WebSocket', run_id: this.runId, time: new Date().toISOString() })
      return this
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0
    }

    this.ws.onmessage = (event) => {
      try {
        const msg: StreamMessage = JSON.parse(event.data)
        this.emit(msg)

        // Auto-disconnect when run finishes
        if (msg.type === 'done' || msg.type === 'error') {
          this.disconnect()
        }
      } catch {
        // Non-JSON message — emit as raw stdout
        this.emit({
          type: 'stdout',
          payload: event.data,
          run_id: this.runId,
          time: new Date().toISOString(),
        })
      }
    }

    this.ws.onerror = () => {
      this.emit({
        type: 'error',
        payload: 'WebSocket connection error',
        run_id: this.runId,
        time: new Date().toISOString(),
      })
    }

    this.ws.onclose = (event) => {
      if (this.stopped) return

      // Attempt reconnect for non-normal closures
      if (!event.wasClean && this.reconnectAttempts < this.maxReconnects) {
        this.reconnectAttempts++
        setTimeout(() => this.connect(), this.reconnectDelay * this.reconnectAttempts)
      }
    }

    return this
  }

  // Close the WebSocket connection
  disconnect(): void {
    this.stopped = true
    if (this.ws) {
      this.ws.close(1000, 'client disconnect')
      this.ws = null
    }
  }

  private emit(msg: StreamMessage): void {
    for (const handler of this.handlers) {
      try {
        handler(msg)
      } catch {
        // Handler errors must not crash the stream
      }
    }
  }
}

// ── Hook: useRunStream ────────────────────────────────────────────────────────

import { useEffect, useRef, useCallback } from 'react'

/**
 * React hook that manages a RunStream lifecycle tied to a component.
 * Automatically connects on mount and disconnects on unmount.
 */
export function useRunStream(
  orgId: string,
  runId: string | null,
  onMessage: StreamHandler,
  enabled = true
) {
  const streamRef = useRef<RunStream | null>(null)
  const handlerRef = useRef(onMessage)
  handlerRef.current = onMessage

  const stableHandler = useCallback((msg: StreamMessage) => {
    handlerRef.current(msg)
  }, [])

  useEffect(() => {
    if (!enabled || !runId) return

    const stream = new RunStream(orgId, runId)
    stream.onMessage(stableHandler).connect()
    streamRef.current = stream

    return () => {
      stream.disconnect()
      streamRef.current = null
    }
  }, [orgId, runId, enabled, stableHandler])

  return {
    disconnect: () => streamRef.current?.disconnect(),
  }
}
