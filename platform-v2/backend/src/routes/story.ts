/**
 * Story API Routes
 */

import { Router, Request, Response } from 'express';

export const storyRouter = Router();

// Get all stories
storyRouter.get('/', async (req: Request, res: Response) => {
  try {
    const stories = await req.platformState.getAllStories();

    // Optional filtering
    const { status, sprint, tag } = req.query;

    let filtered = stories;
    if (status) {
      filtered = filtered.filter(s => s.status === status);
    }
    if (sprint) {
      filtered = filtered.filter(s => s.sprint === sprint);
    }
    if (tag) {
      filtered = filtered.filter(s => s.tags.includes(tag as string));
    }

    res.json({ stories: filtered, total: filtered.length });
  } catch (error) {
    console.error('Failed to get stories:', error);
    res.status(500).json({ error: 'Failed to get stories' });
  }
});

// Get backlog index
storyRouter.get('/backlog', async (req: Request, res: Response) => {
  try {
    const backlog = await req.platformState.getBacklogIndex();
    res.json(backlog);
  } catch (error) {
    console.error('Failed to get backlog:', error);
    res.status(500).json({ error: 'Failed to get backlog' });
  }
});

// Rebuild backlog index
storyRouter.post('/backlog/rebuild', async (req: Request, res: Response) => {
  try {
    const backlog = await req.platformState.rebuildBacklogIndex();
    res.json(backlog);
  } catch (error) {
    console.error('Failed to rebuild backlog:', error);
    res.status(500).json({ error: 'Failed to rebuild backlog' });
  }
});

// Create a new story
storyRouter.post('/', async (req: Request, res: Response) => {
  try {
    const storyData = req.body;

    // Generate ID if not provided
    if (!storyData.id) {
      storyData.id = await req.platformState.getNextStoryId();
    }

    // Set defaults
    const story = {
      ...storyData,
      status: storyData.status || 'todo',
      sprint: null,
      branch: null,
      dependencies: storyData.dependencies || [],
      linked_stories: storyData.linked_stories || [],
      tags: storyData.tags || [],
      agent_assigned: null,
      result: {
        status: null,
        pr_url: null,
        review_notes: null,
        failing_checks: [],
      },
    };

    const created = await req.platformState.createStory(story);

    // Rebuild backlog index
    await req.platformState.rebuildBacklogIndex();

    res.status(201).json(created);
  } catch (error) {
    console.error('Failed to create story:', error);
    res.status(500).json({ error: 'Failed to create story' });
  }
});

// Get specific story
storyRouter.get('/:storyId', async (req: Request, res: Response) => {
  try {
    const story = await req.platformState.getStory(req.params.storyId);
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }
    res.json(story);
  } catch (error) {
    console.error('Failed to get story:', error);
    res.status(500).json({ error: 'Failed to get story' });
  }
});

// Update story
storyRouter.patch('/:storyId', async (req: Request, res: Response) => {
  try {
    const story = await req.platformState.updateStory(req.params.storyId, req.body);
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }

    // Broadcast update
    req.broadcast({
      type: 'story.progress',
      message: `Story ${story.id} updated`,
      data: story,
    });

    res.json(story);
  } catch (error) {
    console.error('Failed to update story:', error);
    res.status(500).json({ error: 'Failed to update story' });
  }
});

// Update story status
storyRouter.patch('/:storyId/status', async (req: Request, res: Response) => {
  try {
    const { status, reason } = req.body;

    const story = await req.platformState.updateStory(req.params.storyId, { status });
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }

    // Log appropriate event
    const eventType = `story.${status === 'done' ? 'completed' : status === 'blocked' ? 'blocked' : 'started'}`;
    await req.platformState.appendEvent({
      type: eventType as any,
      story_id: story.id,
      data: { reason },
    });

    req.broadcast({
      type: 'story.progress',
      message: `Story ${story.id} is now ${status}`,
      data: story,
    });

    res.json(story);
  } catch (error) {
    console.error('Failed to update story status:', error);
    res.status(500).json({ error: 'Failed to update story status' });
  }
});

// Set story result
storyRouter.patch('/:storyId/result', async (req: Request, res: Response) => {
  try {
    const { status, pr_url, review_notes, failing_checks } = req.body;

    const story = await req.platformState.getStory(req.params.storyId);
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }

    const updated = await req.platformState.updateStory(req.params.storyId, {
      result: {
        status: status || story.result.status,
        pr_url: pr_url || story.result.pr_url,
        review_notes: review_notes || story.result.review_notes,
        failing_checks: failing_checks || story.result.failing_checks,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Failed to update story result:', error);
    res.status(500).json({ error: 'Failed to update story result' });
  }
});

// Get story dependencies
storyRouter.get('/:storyId/dependencies', async (req: Request, res: Response) => {
  try {
    const story = await req.platformState.getStory(req.params.storyId);
    if (!story) {
      return res.status(404).json({ error: 'Story not found' });
    }

    const dependencies = await Promise.all(
      story.dependencies.map(id => req.platformState.getStory(id))
    );

    const dependents = (await req.platformState.getAllStories()).filter(s =>
      s.dependencies.includes(req.params.storyId)
    );

    res.json({
      storyId: story.id,
      dependencies: dependencies.filter(Boolean),
      dependents,
    });
  } catch (error) {
    console.error('Failed to get dependencies:', error);
    res.status(500).json({ error: 'Failed to get dependencies' });
  }
});

// Get contract for story
storyRouter.get('/:storyId/contract', async (req: Request, res: Response) => {
  try {
    const contract = await req.platformState.getContract(req.params.storyId);
    if (!contract) {
      return res.status(404).json({ error: 'Contract not found' });
    }
    res.json(contract);
  } catch (error) {
    console.error('Failed to get contract:', error);
    res.status(500).json({ error: 'Failed to get contract' });
  }
});

// Create/update contract for story
storyRouter.put('/:storyId/contract', async (req: Request, res: Response) => {
  try {
    const contract = {
      story_id: req.params.storyId,
      exports: req.body.exports || [],
    };

    await req.platformState.createContract(contract);
    res.json(contract);
  } catch (error) {
    console.error('Failed to update contract:', error);
    res.status(500).json({ error: 'Failed to update contract' });
  }
});
