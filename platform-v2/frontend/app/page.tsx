'use client'

import { useState, useEffect } from 'react'
import { ChatPanel } from '@/components/ChatPanel'
import { Dashboard } from '@/components/Dashboard'
import { SettingsPanel } from '@/components/SettingsPanel'
import { useWebSocket } from '@/lib/useWebSocket'
import { useStore } from '@/lib/store'

export default function Home() {
  const [showSettings, setShowSettings] = useState(false)
  const { connected, messages } = useWebSocket()
  const { project, setProject, fetchStatus } = useStore()

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  return (
    <main className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between bg-gray-900/50 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-white">
            Multi-Agent Developer Platform
          </h1>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
            connected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
          title="Settings"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat panel - 60% */}
        <div className="w-3/5 border-r border-gray-800 flex flex-col">
          <ChatPanel />
        </div>

        {/* Dashboard - 40% */}
        <div className="w-2/5 flex flex-col overflow-hidden">
          <Dashboard />
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}
    </main>
  )
}
