'use client'

import { useState } from 'react'
import { useStore } from '@/lib/store'

interface SettingsPanelProps {
  onClose: () => void
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { settings, updateSettings } = useStore()
  const [localSettings, setLocalSettings] = useState(settings)

  const handleSave = async () => {
    updateSettings(localSettings)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          {/* Agent Count */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Parallel Agents
            </label>
            <select
              value={localSettings.maxAgents}
              onChange={(e) => setLocalSettings({ ...localSettings, maxAgents: parseInt(e.target.value) })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-platform-500"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                <option key={n} value={n}>{n} agent{n > 1 ? 's' : ''}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Number of developer agents that can work simultaneously
            </p>
          </div>

          {/* CLI Tool */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              CLI Tool
            </label>
            <select
              value={localSettings.cliTool}
              onChange={(e) => setLocalSettings({ ...localSettings, cliTool: e.target.value as any })}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-platform-500"
            >
              <option value="claude-code">Claude Code</option>
              <option value="github-copilot">GitHub Copilot</option>
              <option value="codex">Codex</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              The AI coding assistant to use for agents
            </p>
          </div>

          {/* State Backend */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              State Backend
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="stateBackend"
                  value="local"
                  checked={localSettings.stateBackend === 'local'}
                  onChange={(e) => setLocalSettings({ ...localSettings, stateBackend: 'local' })}
                  className="w-4 h-4 text-platform-600 bg-gray-800 border-gray-600 focus:ring-platform-500"
                />
                <span className="text-sm">Local (.platform/)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="stateBackend"
                  value="azure-devops"
                  checked={localSettings.stateBackend === 'azure-devops'}
                  onChange={(e) => setLocalSettings({ ...localSettings, stateBackend: 'azure-devops' })}
                  className="w-4 h-4 text-platform-600 bg-gray-800 border-gray-600 focus:ring-platform-500"
                />
                <span className="text-sm">Azure DevOps</span>
              </label>
            </div>
          </div>

          {/* Cost Alert Threshold */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Cost Alert Threshold (USD)
            </label>
            <input
              type="number"
              value={localSettings.costAlertThreshold}
              onChange={(e) => setLocalSettings({ ...localSettings, costAlertThreshold: parseFloat(e.target.value) })}
              min="1"
              step="1"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-platform-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Alert when cumulative cost exceeds this amount
            </p>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2 bg-platform-600 hover:bg-platform-700 rounded-lg font-medium transition-colors"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  )
}
