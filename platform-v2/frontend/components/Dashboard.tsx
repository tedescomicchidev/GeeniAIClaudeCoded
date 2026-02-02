'use client'

import { useStore } from '@/lib/store'

export function Dashboard() {
  const { project, progress, agents, activeSprint } = useStore()

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      done: 'text-green-400',
      'in-progress': 'text-yellow-400',
      'in-review': 'text-blue-400',
      blocked: 'text-red-400',
      todo: 'text-gray-400',
    }
    return colors[status] || 'text-gray-400'
  }

  const getStatusIcon = (status: string) => {
    const icons: Record<string, string> = {
      done: '✓',
      'in-progress': '⟳',
      'in-review': '◎',
      blocked: '✕',
      todo: '○',
    }
    return icons[status] || '○'
  }

  const progressPercent = progress?.storyPoints?.progressPercent || 0

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Sprint Progress */}
      <div className="p-4 border-b border-gray-800">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <svg className="w-5 h-5 text-platform-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Sprint Progress
        </h2>

        {/* Progress bar */}
        <div className="mb-4">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-400">Overall Progress</span>
            <span className="font-medium">{progressPercent}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2.5">
            <div
              className="bg-platform-500 h-2.5 rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-800/50 rounded-lg p-3">
            <p className="text-2xl font-bold text-green-400">{progress?.stories?.completed || 0}</p>
            <p className="text-xs text-gray-400">Completed</p>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3">
            <p className="text-2xl font-bold text-yellow-400">{progress?.stories?.inProgress || 0}</p>
            <p className="text-xs text-gray-400">In Progress</p>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3">
            <p className="text-2xl font-bold text-red-400">{progress?.stories?.blocked || 0}</p>
            <p className="text-xs text-gray-400">Blocked</p>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3">
            <p className="text-2xl font-bold text-gray-400">{progress?.stories?.todo || 0}</p>
            <p className="text-xs text-gray-400">Todo</p>
          </div>
        </div>
      </div>

      {/* Stories */}
      <div className="p-4 border-b border-gray-800">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <svg className="w-5 h-5 text-platform-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
          Stories
          <span className="text-sm font-normal text-gray-400">
            ({activeSprint?.id || 'No active sprint'})
          </span>
        </h2>

        {activeSprint?.stories && activeSprint.stories.length > 0 ? (
          <div className="space-y-2">
            {activeSprint.stories.map((storyId: string) => (
              <div
                key={storyId}
                className="bg-gray-800/50 rounded-lg p-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <span className={`text-lg ${getStatusColor('in-progress')}`}>
                    {getStatusIcon('in-progress')}
                  </span>
                  <span className="font-mono text-sm">{storyId}</span>
                </div>
                <span className="text-xs text-gray-500">In progress</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm">No stories in current sprint</p>
        )}
      </div>

      {/* Active Agents */}
      <div className="p-4 flex-1">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <svg className="w-5 h-5 text-platform-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          Active Agents
          <span className="text-sm font-normal text-gray-400">
            ({agents.length} running)
          </span>
        </h2>

        {agents.length > 0 ? (
          <div className="space-y-2">
            {agents.map((agent) => (
              <div
                key={agent.agent_id}
                className="bg-gray-800/50 rounded-lg p-3"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <span className="font-medium">{agent.agent_id}</span>
                  </div>
                  <span className="text-xs px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded">
                    {agent.role}
                  </span>
                </div>
                {agent.story_id && (
                  <p className="text-sm text-gray-400">
                    Working on: <span className="font-mono">{agent.story_id}</span>
                  </p>
                )}
                {agent.current_task && (
                  <p className="text-xs text-gray-500 mt-1">{agent.current_task}</p>
                )}
                {agent.progress_percent !== undefined && (
                  <div className="mt-2">
                    <div className="w-full bg-gray-700 rounded-full h-1">
                      <div
                        className="bg-platform-500 h-1 rounded-full"
                        style={{ width: `${agent.progress_percent}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-gray-500 py-8">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <p className="text-sm">No active agents</p>
            <p className="text-xs mt-1">Agents will appear here when working on stories</p>
          </div>
        )}
      </div>

      {/* Cost tracking */}
      {project?.total_cost_usd !== undefined && (
        <div className="p-4 border-t border-gray-800">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">Total Cost</span>
            <span className="font-medium">${project.total_cost_usd.toFixed(2)} USD</span>
          </div>
        </div>
      )}
    </div>
  )
}
