/**
 * Sprint API Routes
 */

import { Router, Request, Response } from 'express';

export const sprintRouter = Router();

// Create a new sprint
sprintRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { goal, storyIds } = req.body;

    if (!goal || !storyIds || storyIds.length === 0) {
      return res.status(400).json({ error: 'Goal and story IDs are required' });
    }

    // Validate stories exist
    for (const storyId of storyIds) {
      const story = await req.platformState.getStory(storyId);
      if (!story) {
        return res.status(400).json({ error: `Story ${storyId} not found` });
      }
    }

    const sprint = await req.platformState.createSprint(goal, storyIds);

    await req.platformState.appendEvent({
      type: 'sprint.planned',
      sprint_id: sprint.id,
      data: { goal, storyCount: storyIds.length },
    });

    req.broadcast({
      type: 'sprint.progress',
      message: `Sprint ${sprint.id} planned`,
      data: sprint,
    });

    res.status(201).json(sprint);
  } catch (error) {
    console.error('Failed to create sprint:', error);
    res.status(500).json({ error: 'Failed to create sprint' });
  }
});

// Get all sprints
sprintRouter.get('/', async (req: Request, res: Response) => {
  try {
    const sprints = await req.platformState.getAllSprints();
    res.json({ sprints });
  } catch (error) {
    console.error('Failed to get sprints:', error);
    res.status(500).json({ error: 'Failed to get sprints' });
  }
});

// Get specific sprint
sprintRouter.get('/:sprintId', async (req: Request, res: Response) => {
  try {
    const sprint = await req.platformState.getSprint(req.params.sprintId);
    if (!sprint) {
      return res.status(404).json({ error: 'Sprint not found' });
    }

    // Get full story details
    const stories = await Promise.all(
      sprint.stories.map(id => req.platformState.getStory(id))
    );

    res.json({
      ...sprint,
      storyDetails: stories.filter(Boolean),
    });
  } catch (error) {
    console.error('Failed to get sprint:', error);
    res.status(500).json({ error: 'Failed to get sprint' });
  }
});

// Start a sprint
sprintRouter.post('/:sprintId/start', async (req: Request, res: Response) => {
  try {
    const sprint = await req.platformState.getSprint(req.params.sprintId);
    if (!sprint) {
      return res.status(404).json({ error: 'Sprint not found' });
    }

    if (sprint.status !== 'planning') {
      return res.status(400).json({ error: 'Sprint is not in planning status' });
    }

    const updated = await req.platformState.updateSprint(req.params.sprintId, {
      status: 'active',
      started_at: new Date().toISOString(),
    });

    // Update story statuses
    for (const storyId of sprint.stories) {
      await req.platformState.updateStory(storyId, {
        sprint: sprint.id,
        status: 'in-progress',
      });
    }

    await req.platformState.appendEvent({
      type: 'sprint.started',
      sprint_id: sprint.id,
      data: { stories: sprint.stories },
    });

    req.broadcast({
      type: 'sprint.progress',
      message: `Sprint ${sprint.id} started`,
      data: updated,
    });

    res.json(updated);
  } catch (error) {
    console.error('Failed to start sprint:', error);
    res.status(500).json({ error: 'Failed to start sprint' });
  }
});

// Complete a sprint
sprintRouter.post('/:sprintId/complete', async (req: Request, res: Response) => {
  try {
    const sprint = await req.platformState.getSprint(req.params.sprintId);
    if (!sprint) {
      return res.status(404).json({ error: 'Sprint not found' });
    }

    const updated = await req.platformState.updateSprint(req.params.sprintId, {
      status: 'done',
      completed_at: new Date().toISOString(),
    });

    await req.platformState.appendEvent({
      type: 'sprint.completed',
      sprint_id: sprint.id,
      data: {},
    });

    req.broadcast({
      type: 'sprint.progress',
      message: `Sprint ${sprint.id} completed`,
      data: updated,
    });

    // Regenerate docs
    await req.markdownGenerator.generateAll();

    res.json(updated);
  } catch (error) {
    console.error('Failed to complete sprint:', error);
    res.status(500).json({ error: 'Failed to complete sprint' });
  }
});

// Get sprint assignments
sprintRouter.get('/:sprintId/assignments', async (req: Request, res: Response) => {
  try {
    const assignments = await req.platformState.getSprintAssignments(req.params.sprintId);
    res.json(assignments || { sprint_id: req.params.sprintId, assignments: [] });
  } catch (error) {
    console.error('Failed to get assignments:', error);
    res.status(500).json({ error: 'Failed to get assignments' });
  }
});

// Get sprint review
sprintRouter.get('/:sprintId/review', async (req: Request, res: Response) => {
  try {
    const sprint = await req.platformState.getSprint(req.params.sprintId);
    if (!sprint || !sprint.review_id) {
      return res.status(404).json({ error: 'Review not found' });
    }

    const review = await req.platformState.getReview(sprint.review_id);
    res.json(review);
  } catch (error) {
    console.error('Failed to get review:', error);
    res.status(500).json({ error: 'Failed to get review' });
  }
});
