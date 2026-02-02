'use client'

import { create } from 'zustand'

interface Message {
  id: string
  type: 'user' | 'agent' | 'system'
  content: string
  sender?: string
  timestamp: string
}

interface Project {
  id: string
  name: string
  status: string
  total_cost_usd: number
}

interface Progress {
  stories: {
    total: number
    completed: number
    inProgress: number
    blocked: number
    todo: number
  }
  storyPoints: {
    total: number
    completed: number
    remaining: number
    progressPercent: number
  }
  sprints: {
    total: number
    completed: number
    active: string | null
  }
}

interface Agent {
  agent_id: string
  role: string
  story_id: string | null
  sprint_id: string | null
  status: string
  current_task?: string
  progress_percent?: number
}

interface Sprint {
  id: string
  status: string
  goal: string
  stories: string[]
  agents_active: number
}

interface Settings {
  maxAgents: number
  cliTool: 'claude-code' | 'github-copilot' | 'codex'
  stateBackend: 'local' | 'azure-devops'
  costAlertThreshold: number
}

interface Store {
  // Messages
  messages: Message[]
  addMessage: (message: Message) => void
  clearMessages: () => void

  // Project
  project: Project | null
  setProject: (project: Project | null) => void

  // Progress
  progress: Progress | null
  setProgress: (progress: Progress) => void

  // Agents
  agents: Agent[]
  setAgents: (agents: Agent[]) => void
  updateAgent: (agentId: string, updates: Partial<Agent>) => void

  // Active Sprint
  activeSprint: Sprint | null
  setActiveSprint: (sprint: Sprint | null) => void

  // Settings
  settings: Settings
  updateSettings: (settings: Partial<Settings>) => void

  // Actions
  fetchStatus: () => Promise<void>
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'

export const useStore = create<Store>((set, get) => ({
  // Messages
  messages: [],
  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),
  clearMessages: () => set({ messages: [] }),

  // Project
  project: null,
  setProject: (project) => set({ project }),

  // Progress
  progress: null,
  setProgress: (progress) => set({ progress }),

  // Agents
  agents: [],
  setAgents: (agents) => set({ agents }),
  updateAgent: (agentId, updates) =>
    set((state) => ({
      agents: state.agents.map((a) =>
        a.agent_id === agentId ? { ...a, ...updates } : a
      ),
    })),

  // Active Sprint
  activeSprint: null,
  setActiveSprint: (sprint) => set({ activeSprint: sprint }),

  // Settings
  settings: {
    maxAgents: 4,
    cliTool: 'claude-code',
    stateBackend: 'local',
    costAlertThreshold: 50,
  },
  updateSettings: (newSettings) =>
    set((state) => ({
      settings: { ...state.settings, ...newSettings },
    })),

  // Actions
  fetchStatus: async () => {
    try {
      const response = await fetch(`${API_URL}/api/status`)
      if (response.ok) {
        const data = await response.json()

        set({
          project: data.project,
          activeSprint: data.activeSprint,
          agents: data.activeAgents || [],
        })

        // Fetch progress separately
        const progressResponse = await fetch(`${API_URL}/api/project/progress`)
        if (progressResponse.ok) {
          const progressData = await progressResponse.json()
          set({ progress: progressData })
        }
      }
    } catch (error) {
      console.error('Failed to fetch status:', error)
    }
  },
}))
