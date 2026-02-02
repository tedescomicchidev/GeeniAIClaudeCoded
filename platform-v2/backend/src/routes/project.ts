/**
 * Project API Routes
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const projectRouter = Router();

// Create a new project
projectRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { idea, name, repoUrl, config } = req.body;

    if (!idea) {
      return res.status(400).json({ error: 'Idea is required' });
    }

    // Create project
    const project = await req.platformState.createProject(
      idea,
      name || 'New Project',
      repoUrl || ''
    );

    // Update config if provided
    if (config) {
      const currentConfig = await req.platformState.getConfig();
      if (currentConfig) {
        currentConfig.platform = { ...currentConfig.platform, ...config };
        await req.platformState.updateConfig(currentConfig);
      }
    }

    // Log event
    await req.platformState.appendEvent({
      type: 'project.created',
      data: { projectId: project.id, idea: idea.substring(0, 100) },
    });

    // Broadcast to connected clients
    req.broadcast({
      type: 'project.created',
      message: 'New project created',
      data: { projectId: project.id, name: project.name },
    });

    res.status(201).json(project);
  } catch (error) {
    console.error('Failed to create project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Get current project
projectRouter.get('/', async (req: Request, res: Response) => {
  try {
    const project = await req.platformState.getProject();
    if (!project) {
      return res.status(404).json({ error: 'No project found' });
    }
    res.json(project);
  } catch (error) {
    console.error('Failed to get project:', error);
    res.status(500).json({ error: 'Failed to get project' });
  }
});

// Update project
projectRouter.patch('/', async (req: Request, res: Response) => {
  try {
    const updates = req.body;
    const project = await req.platformState.updateProject(updates);

    await req.platformState.appendEvent({
      type: 'project.updated',
      data: { updates: Object.keys(updates) },
    });

    req.broadcast({
      type: 'project.update',
      message: 'Project updated',
      data: project,
    });

    res.json(project);
  } catch (error) {
    console.error('Failed to update project:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// Start project (begin PM agent)
projectRouter.post('/start', async (req: Request, res: Response) => {
  try {
    const project = await req.platformState.getProject();
    if (!project) {
      return res.status(404).json({ error: 'No project found' });
    }

    // Update project status
    await req.platformState.updateProject({ status: 'planning' });

    // Log event
    await req.platformState.appendEvent({
      type: 'planning.started',
      data: { projectId: project.id },
    });

    req.broadcast({
      type: 'planning.progress',
      message: 'Starting project planning...',
      data: { status: 'planning' },
    });

    // In a real implementation, this would spawn the PM agent
    // via the agent-launcher MCP server or K8s API

    res.json({
      success: true,
      message: 'Project started',
      status: 'planning',
    });
  } catch (error) {
    console.error('Failed to start project:', error);
    res.status(500).json({ error: 'Failed to start project' });
  }
});

// Get project progress summary
projectRouter.get('/progress', async (req: Request, res: Response) => {
  try {
    const [project, stories, sprints] = await Promise.all([
      req.platformState.getProject(),
      req.platformState.getAllStories(),
      req.platformState.getAllSprints(),
    ]);

    if (!project) {
      return res.status(404).json({ error: 'No project found' });
    }

    const totalStories = stories.length;
    const completedStories = stories.filter(s => s.status === 'done').length;
    const inProgressStories = stories.filter(s => s.status === 'in-progress').length;
    const blockedStories = stories.filter(s => s.status === 'blocked').length;

    const totalPoints = stories.reduce((sum, s) => sum + (s.story_points || 0), 0);
    const completedPoints = stories
      .filter(s => s.status === 'done')
      .reduce((sum, s) => sum + (s.story_points || 0), 0);

    const activeSprint = sprints.find(s => s.status === 'active');
    const completedSprints = sprints.filter(s => s.status === 'done').length;

    res.json({
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        totalCostUsd: project.total_cost_usd,
      },
      stories: {
        total: totalStories,
        completed: completedStories,
        inProgress: inProgressStories,
        blocked: blockedStories,
        todo: totalStories - completedStories - inProgressStories - blockedStories,
      },
      storyPoints: {
        total: totalPoints,
        completed: completedPoints,
        remaining: totalPoints - completedPoints,
        progressPercent: totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0,
      },
      sprints: {
        total: sprints.length,
        completed: completedSprints,
        active: activeSprint?.id || null,
      },
    });
  } catch (error) {
    console.error('Failed to get progress:', error);
    res.status(500).json({ error: 'Failed to get progress' });
  }
});
