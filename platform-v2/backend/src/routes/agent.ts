/**
 * Agent API Routes
 */

import { Router, Request, Response } from 'express';

export const agentRouter = Router();

// Get agent registry
agentRouter.get('/', async (req: Request, res: Response) => {
  try {
    const registry = await req.platformState.getAgentRegistry();
    res.json(registry);
  } catch (error) {
    console.error('Failed to get agent registry:', error);
    res.status(500).json({ error: 'Failed to get agent registry' });
  }
});

// Get all active agents
agentRouter.get('/active', async (req: Request, res: Response) => {
  try {
    const heartbeats = await req.platformState.getAllHeartbeats();
    const activeAgents = heartbeats.filter(h => h.status === 'running' || h.status === 'pending');
    res.json({ agents: activeAgents, count: activeAgents.length });
  } catch (error) {
    console.error('Failed to get active agents:', error);
    res.status(500).json({ error: 'Failed to get active agents' });
  }
});

// Get specific agent heartbeat
agentRouter.get('/:agentId', async (req: Request, res: Response) => {
  try {
    const heartbeat = await req.platformState.getAgentHeartbeat(req.params.agentId);
    if (!heartbeat) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.json(heartbeat);
  } catch (error) {
    console.error('Failed to get agent:', error);
    res.status(500).json({ error: 'Failed to get agent' });
  }
});

// Update agent heartbeat (called by agents)
agentRouter.put('/:agentId/heartbeat', async (req: Request, res: Response) => {
  try {
    const { status, current_task, progress_percent, error_message } = req.body;

    const existing = await req.platformState.getAgentHeartbeat(req.params.agentId);
    if (!existing) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const updated = {
      ...existing,
      status: status || existing.status,
      current_task: current_task || existing.current_task,
      progress_percent: progress_percent ?? existing.progress_percent,
      error_message: error_message,
      last_heartbeat: new Date().toISOString(),
    };

    if (status === 'completed' || status === 'failed') {
      updated.completed_at = new Date().toISOString();
    }

    await req.platformState.updateAgentHeartbeat(updated);

    // Broadcast status change
    req.broadcast({
      type: 'agent.status',
      message: `Agent ${req.params.agentId} ${status}`,
      data: updated,
    });

    res.json(updated);
  } catch (error) {
    console.error('Failed to update heartbeat:', error);
    res.status(500).json({ error: 'Failed to update heartbeat' });
  }
});

// Get agents for a specific sprint
agentRouter.get('/sprint/:sprintId', async (req: Request, res: Response) => {
  try {
    const heartbeats = await req.platformState.getAllHeartbeats();
    const sprintAgents = heartbeats.filter(h => h.sprint_id === req.params.sprintId);
    res.json({ agents: sprintAgents, count: sprintAgents.length });
  } catch (error) {
    console.error('Failed to get sprint agents:', error);
    res.status(500).json({ error: 'Failed to get sprint agents' });
  }
});

// Check for timed-out agents
agentRouter.get('/check/timeouts', async (req: Request, res: Response) => {
  try {
    const config = await req.platformState.getConfig();
    const timeoutSeconds = config?.platform.timeouts.agent_heartbeat_seconds || 900;

    const heartbeats = await req.platformState.getAllHeartbeats();
    const now = Date.now();

    const timedOut = heartbeats.filter(h => {
      if (h.status !== 'running' && h.status !== 'pending') return false;
      const lastHeartbeat = new Date(h.last_heartbeat).getTime();
      return (now - lastHeartbeat) > timeoutSeconds * 1000;
    });

    res.json({
      timedOut,
      count: timedOut.length,
      timeoutSeconds,
    });
  } catch (error) {
    console.error('Failed to check timeouts:', error);
    res.status(500).json({ error: 'Failed to check timeouts' });
  }
});

// Mark agent as timed out
agentRouter.post('/:agentId/timeout', async (req: Request, res: Response) => {
  try {
    const heartbeat = await req.platformState.getAgentHeartbeat(req.params.agentId);
    if (!heartbeat) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const updated = {
      ...heartbeat,
      status: 'timeout' as const,
      error_message: 'Agent timed out (no heartbeat)',
      completed_at: new Date().toISOString(),
    };

    await req.platformState.updateAgentHeartbeat(updated);

    await req.platformState.appendEvent({
      type: 'agent.timeout',
      agent_id: req.params.agentId,
      story_id: heartbeat.story_id || undefined,
      data: { last_heartbeat: heartbeat.last_heartbeat },
    });

    req.broadcast({
      type: 'agent.status',
      message: `Agent ${req.params.agentId} timed out`,
      data: updated,
    });

    res.json(updated);
  } catch (error) {
    console.error('Failed to mark timeout:', error);
    res.status(500).json({ error: 'Failed to mark timeout' });
  }
});
