'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useStore } from './store'

interface WebSocketMessage {
  type: string
  message: string
  data?: any
  timestamp: string
}

export function useWebSocket() {
  const ws = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const reconnectAttempts = useRef(0)
  const maxReconnectAttempts = 5
  const reconnectDelay = 2000

  const { addMessage, setAgents, updateAgent, setProgress, setActiveSprint } = useStore()

  const connect = useCallback(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3000/ws/progress'

    try {
      ws.current = new WebSocket(`${wsUrl}?projectId=default`)

      ws.current.onopen = () => {
        console.log('WebSocket connected')
        setConnected(true)
        reconnectAttempts.current = 0
      }

      ws.current.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data)
          handleMessage(message)
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error)
        }
      }

      ws.current.onclose = () => {
        console.log('WebSocket disconnected')
        setConnected(false)
        attemptReconnect()
      }

      ws.current.onerror = (error) => {
        console.error('WebSocket error:', error)
        setConnected(false)
      }
    } catch (error) {
      console.error('Failed to connect WebSocket:', error)
      attemptReconnect()
    }
  }, [])

  const attemptReconnect = useCallback(() => {
    if (reconnectAttempts.current >= maxReconnectAttempts) {
      console.log('Max reconnection attempts reached')
      return
    }

    reconnectAttempts.current++
    const delay = reconnectDelay * Math.pow(2, reconnectAttempts.current - 1)

    console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current})`)

    setTimeout(() => {
      connect()
    }, delay)
  }, [connect])

  const handleMessage = useCallback((message: WebSocketMessage) => {
    switch (message.type) {
      case 'connection.established':
        console.log('WebSocket connection confirmed')
        break

      case 'chat.message':
        addMessage({
          id: Date.now().toString(),
          type: 'agent',
          content: message.message,
          sender: message.data?.sender,
          timestamp: message.timestamp,
        })
        break

      case 'project.update':
      case 'planning.progress':
      case 'sprint.progress':
      case 'story.progress':
        addMessage({
          id: Date.now().toString(),
          type: 'system',
          content: message.message,
          timestamp: message.timestamp,
        })
        break

      case 'agent.status':
        if (message.data) {
          updateAgent(message.data.agent_id, message.data)
        }
        break

      case 'dashboard.update':
        if (message.data?.sprintProgress) {
          // Update progress from dashboard data
        }
        if (message.data?.activeAgents) {
          setAgents(message.data.activeAgents)
        }
        break

      case 'input.request':
        // Handle input requests from agents
        addMessage({
          id: Date.now().toString(),
          type: 'system',
          content: `Agent requests input: ${message.message}`,
          timestamp: message.timestamp,
        })
        break

      case 'error':
        addMessage({
          id: Date.now().toString(),
          type: 'system',
          content: `Error: ${message.message}`,
          timestamp: message.timestamp,
        })
        break

      default:
        console.log('Unknown message type:', message.type)
    }
  }, [addMessage, updateAgent, setAgents])

  const sendMessage = useCallback((data: object) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(data))
      return true
    }
    return false
  }, [])

  useEffect(() => {
    connect()

    return () => {
      if (ws.current) {
        ws.current.close()
      }
    }
  }, [connect])

  return {
    connected,
    sendMessage,
    messages: useStore.getState().messages,
  }
}
