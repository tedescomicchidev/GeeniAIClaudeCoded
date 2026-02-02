'use client'

import { useState, useRef, useEffect } from 'react'
import { useStore } from '@/lib/store'
import { useWebSocket } from '@/lib/useWebSocket'

interface Message {
  id: string
  type: 'user' | 'agent' | 'system'
  content: string
  sender?: string
  timestamp: string
}

export function ChatPanel() {
  const [input, setInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { messages, addMessage } = useStore()
  const { sendMessage, connected } = useWebSocket()

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isSubmitting) return

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    }

    addMessage(userMessage)
    setInput('')
    setIsSubmitting(true)

    try {
      // Send to backend API
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea: userMessage.content }),
      })

      if (response.ok) {
        const data = await response.json()
        addMessage({
          id: Date.now().toString(),
          type: 'system',
          content: `Project created! Starting planning phase...`,
          timestamp: new Date().toISOString(),
        })
      }
    } catch (error) {
      addMessage({
        id: Date.now().toString(),
        type: 'system',
        content: 'Failed to send message. Please try again.',
        timestamp: new Date().toISOString(),
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const getSenderIcon = (type: string, sender?: string) => {
    if (type === 'user') {
      return (
        <div className="w-8 h-8 rounded-full bg-platform-600 flex items-center justify-center text-sm font-medium">
          U
        </div>
      )
    }
    if (type === 'agent') {
      const icons: Record<string, string> = {
        pm: 'PM',
        'scrum-master': 'SM',
        developer: 'D',
        reviewer: 'R',
      }
      return (
        <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-sm font-medium">
          {icons[sender || 'pm'] || 'A'}
        </div>
      )
    }
    return (
      <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-sm">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-8">
            <p className="text-lg mb-2">Welcome to Multi-Agent Developer Platform</p>
            <p className="text-sm">Describe your application idea and let the agents build it for you.</p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-3 message-enter ${
              message.type === 'user' ? 'flex-row-reverse' : ''
            }`}
          >
            {getSenderIcon(message.type, message.sender)}
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                message.type === 'user'
                  ? 'bg-platform-600 text-white'
                  : message.type === 'agent'
                  ? 'bg-gray-800 text-gray-100'
                  : 'bg-gray-700/50 text-gray-300'
              }`}
            >
              {message.sender && message.type === 'agent' && (
                <p className="text-xs text-purple-400 mb-1 font-medium">
                  {message.sender.toUpperCase()} Agent
                </p>
              )}
              <p className="whitespace-pre-wrap">{message.content}</p>
              <p className="text-xs opacity-50 mt-1">
                {new Date(message.timestamp).toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-gray-800 p-4">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe your application idea..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-platform-500 focus:border-transparent resize-none"
            rows={3}
            disabled={isSubmitting}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit(e)
              }
            }}
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm text-gray-400">
              <span className={connected ? 'text-green-400' : 'text-red-400'}>
                {connected ? '● Connected' : '○ Disconnected'}
              </span>
            </div>
            <button
              type="submit"
              disabled={!input.trim() || isSubmitting}
              className="px-6 py-2 bg-platform-600 hover:bg-platform-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Sending...
                </>
              ) : (
                <>
                  Send
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
