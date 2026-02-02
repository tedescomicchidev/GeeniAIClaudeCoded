/**
 * Platform State Management Service
 * Handles reading/writing YAML state files in .platform/
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { v4 as uuidv4 } from 'uuid';
import type {
  PlatformConfig,
  Project,
  Story,
  Sprint,
  SprintAssignments,
  Review,
  AgentRegistry,
  AgentHeartbeat,
  BacklogIndex,
  PlatformEvent,
  InterfaceContract,
  EventType,
} from '../types/platform.js';

export class PlatformStateService {
  private basePath: string;

  constructor(basePath: string = '/workspace/.platform') {
    this.basePath = basePath;
  }

  /**
   * Helper to read a YAML file
   */
  private async readYaml<T>(relativePath: string): Promise<T | null> {
    const fullPath = path.join(this.basePath, relativePath);
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      return yaml.load(content) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Helper to write a YAML file
   */
  private async writeYaml<T>(relativePath: string, data: T): Promise<void> {
    const fullPath = path.join(this.basePath, relativePath);
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    const content = yaml.dump(data, { indent: 2, lineWidth: 120 });
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  // ==================== Config ====================

  async getConfig(): Promise<PlatformConfig | null> {
    return this.readYaml<PlatformConfig>('config.yaml');
  }

  async updateConfig(config: PlatformConfig): Promise<void> {
    await this.writeYaml('config.yaml', config);
  }

  // ==================== Project ====================

  async getProject(): Promise<Project | null> {
    return this.readYaml<Project>('project.yaml');
  }

  async updateProject(project: Partial<Project>): Promise<Project> {
    const existing = await this.getProject();
    const updated: Project = {
      ...existing,
      ...project,
      updated_at: new Date().toISOString(),
    } as Project;
    await this.writeYaml('project.yaml', updated);
    return updated;
  }

  async createProject(idea: string, name: string, repoUrl: string): Promise<Project> {
    const project: Project = {
      id: uuidv4(),
      name,
      description: '',
      idea,
      repository: {
        url: repoUrl,
        default_branch: 'main',
        clone_path: '/workspace/repo',
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: 'initialized',
      current_sprint: null,
      total_stories: 0,
      completed_stories: 0,
      total_cost_usd: 0,
      constraints: {
        tech_stack: [],
        coding_standards: [],
        testing_requirements: [],
        deployment_target: '',
      },
    };
    await this.writeYaml('project.yaml', project);
    return project;
  }

  // ==================== Stories ====================

  async getStory(storyId: string): Promise<Story | null> {
    return this.readYaml<Story>(`backlog/stories/${storyId}.yaml`);
  }

  async getAllStories(): Promise<Story[]> {
    const storiesDir = path.join(this.basePath, 'backlog/stories');
    try {
      const files = await fs.readdir(storiesDir);
      const storyFiles = files.filter(f => f.startsWith('STORY-') && f.endsWith('.yaml'));
      const stories = await Promise.all(
        storyFiles.map(f => this.readYaml<Story>(`backlog/stories/${f}`))
      );
      return stories.filter((s): s is Story => s !== null);
    } catch {
      return [];
    }
  }

  async createStory(story: Omit<Story, 'created_at' | 'updated_at'>): Promise<Story> {
    const fullStory: Story = {
      ...story,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await this.writeYaml(`backlog/stories/${story.id}.yaml`, fullStory);
    return fullStory;
  }

  async updateStory(storyId: string, updates: Partial<Story>): Promise<Story | null> {
    const existing = await this.getStory(storyId);
    if (!existing) return null;

    const updated: Story = {
      ...existing,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    await this.writeYaml(`backlog/stories/${storyId}.yaml`, updated);
    return updated;
  }

  async getNextStoryId(): Promise<string> {
    const stories = await this.getAllStories();
    const maxNum = stories.reduce((max, s) => {
      const num = parseInt(s.id.replace('STORY-', ''), 10);
      return num > max ? num : max;
    }, 0);
    return `STORY-${String(maxNum + 1).padStart(3, '0')}`;
  }

  // ==================== Backlog Index ====================

  async getBacklogIndex(): Promise<BacklogIndex | null> {
    return this.readYaml<BacklogIndex>('backlog/index.yaml');
  }

  async updateBacklogIndex(index: BacklogIndex): Promise<void> {
    index.last_updated = new Date().toISOString();
    await this.writeYaml('backlog/index.yaml', index);
  }

  async rebuildBacklogIndex(): Promise<BacklogIndex> {
    const stories = await this.getAllStories();
    const index: BacklogIndex = {
      version: '1.0',
      last_updated: new Date().toISOString(),
      total_stories: stories.length,
      stories_by_priority: {
        must_have: [],
        should_have: [],
        could_have: [],
        wont_have: [],
      },
      critical_path: [],
      next_sprint_candidates: [],
    };

    // Categorize by priority
    for (const story of stories) {
      if (story.status === 'done') continue;

      if (story.priority <= 3) {
        index.stories_by_priority.must_have.push(story.id);
      } else if (story.priority <= 6) {
        index.stories_by_priority.should_have.push(story.id);
      } else if (story.priority <= 9) {
        index.stories_by_priority.could_have.push(story.id);
      } else {
        index.stories_by_priority.wont_have.push(story.id);
      }

      // Check if ready for next sprint (no unmet dependencies)
      const depsComplete = await this.checkDependenciesComplete(story);
      if (depsComplete && story.status === 'todo') {
        index.next_sprint_candidates.push(story.id);
      }
    }

    // Sort each category by priority
    const sortByPriority = (ids: string[]) =>
      ids.sort((a, b) => {
        const storyA = stories.find(s => s.id === a);
        const storyB = stories.find(s => s.id === b);
        return (storyA?.priority ?? 10) - (storyB?.priority ?? 10);
      });

    index.stories_by_priority.must_have = sortByPriority(index.stories_by_priority.must_have);
    index.stories_by_priority.should_have = sortByPriority(index.stories_by_priority.should_have);
    index.stories_by_priority.could_have = sortByPriority(index.stories_by_priority.could_have);

    // Find critical path (stories with most dependents)
    const dependentCounts = new Map<string, number>();
    for (const story of stories) {
      for (const depId of story.dependencies) {
        dependentCounts.set(depId, (dependentCounts.get(depId) ?? 0) + 1);
      }
    }
    index.critical_path = [...dependentCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id]) => id);

    await this.updateBacklogIndex(index);
    return index;
  }

  private async checkDependenciesComplete(story: Story): Promise<boolean> {
    for (const depId of story.dependencies) {
      const dep = await this.getStory(depId);
      if (!dep || dep.status !== 'done') {
        return false;
      }
    }
    return true;
  }

  // ==================== Sprints ====================

  async getSprint(sprintId: string): Promise<Sprint | null> {
    return this.readYaml<Sprint>(`sprints/${sprintId}/sprint.yaml`);
  }

  async getAllSprints(): Promise<Sprint[]> {
    const sprintsDir = path.join(this.basePath, 'sprints');
    try {
      const dirs = await fs.readdir(sprintsDir);
      const sprintDirs = dirs.filter(d => d.startsWith('sprint-'));
      const sprints = await Promise.all(
        sprintDirs.map(d => this.readYaml<Sprint>(`sprints/${d}/sprint.yaml`))
      );
      return sprints.filter((s): s is Sprint => s !== null);
    } catch {
      return [];
    }
  }

  async createSprint(goal: string, storyIds: string[]): Promise<Sprint> {
    const sprints = await this.getAllSprints();
    const sprintNum = sprints.length + 1;
    const sprintId = `sprint-${String(sprintNum).padStart(3, '0')}`;

    const sprint: Sprint = {
      id: sprintId,
      status: 'planning',
      goal,
      stories: storyIds,
      started_at: null,
      completed_at: null,
      agents_active: 0,
      review_id: null,
      cost_usd: 0,
    };

    await this.writeYaml(`sprints/${sprintId}/sprint.yaml`, sprint);
    return sprint;
  }

  async updateSprint(sprintId: string, updates: Partial<Sprint>): Promise<Sprint | null> {
    const existing = await this.getSprint(sprintId);
    if (!existing) return null;

    const updated: Sprint = { ...existing, ...updates };
    await this.writeYaml(`sprints/${sprintId}/sprint.yaml`, updated);
    return updated;
  }

  async getSprintAssignments(sprintId: string): Promise<SprintAssignments | null> {
    return this.readYaml<SprintAssignments>(`sprints/${sprintId}/assignments.yaml`);
  }

  async updateSprintAssignments(sprintId: string, assignments: SprintAssignments): Promise<void> {
    await this.writeYaml(`sprints/${sprintId}/assignments.yaml`, assignments);
  }

  // ==================== Reviews ====================

  async getReview(reviewId: string): Promise<Review | null> {
    return this.readYaml<Review>(`reviews/${reviewId}.yaml`);
  }

  async createReview(sprintId: string, reviewerAgentId: string): Promise<Review> {
    const reviewId = `review-${sprintId.replace('sprint-', '')}`;
    const review: Review = {
      id: reviewId,
      sprint_id: sprintId,
      status: 'in-progress',
      started_at: new Date().toISOString(),
      completed_at: null,
      reviewer_agent_id: reviewerAgentId,
      results: [],
      summary: {
        total_stories: 0,
        passed: 0,
        failed: 0,
        conflicts: 0,
        fix_stories_created: 0,
      },
    };

    await this.writeYaml(`reviews/${reviewId}.yaml`, review);
    return review;
  }

  async updateReview(reviewId: string, updates: Partial<Review>): Promise<Review | null> {
    const existing = await this.getReview(reviewId);
    if (!existing) return null;

    const updated: Review = { ...existing, ...updates };
    await this.writeYaml(`reviews/${reviewId}.yaml`, updated);
    return updated;
  }

  // ==================== Agent Registry ====================

  async getAgentRegistry(): Promise<AgentRegistry | null> {
    return this.readYaml<AgentRegistry>('agents/agent-registry.yaml');
  }

  async updateAgentRegistry(registry: AgentRegistry): Promise<void> {
    registry.last_updated = new Date().toISOString();
    await this.writeYaml('agents/agent-registry.yaml', registry);
  }

  async getAgentHeartbeat(agentId: string): Promise<AgentHeartbeat | null> {
    return this.readYaml<AgentHeartbeat>(`agents/heartbeats/${agentId}.yaml`);
  }

  async updateAgentHeartbeat(heartbeat: AgentHeartbeat): Promise<void> {
    heartbeat.last_heartbeat = new Date().toISOString();
    await this.writeYaml(`agents/heartbeats/${heartbeat.agent_id}.yaml`, heartbeat);
  }

  async getAllHeartbeats(): Promise<AgentHeartbeat[]> {
    const heartbeatsDir = path.join(this.basePath, 'agents/heartbeats');
    try {
      const files = await fs.readdir(heartbeatsDir);
      const yamlFiles = files.filter(f => f.endsWith('.yaml'));
      const heartbeats = await Promise.all(
        yamlFiles.map(f => this.readYaml<AgentHeartbeat>(`agents/heartbeats/${f}`))
      );
      return heartbeats.filter((h): h is AgentHeartbeat => h !== null);
    } catch {
      return [];
    }
  }

  // ==================== Contracts ====================

  async getContract(storyId: string): Promise<InterfaceContract | null> {
    return this.readYaml<InterfaceContract>(`contracts/${storyId}.yaml`);
  }

  async createContract(contract: InterfaceContract): Promise<void> {
    await this.writeYaml(`contracts/${contract.story_id}.yaml`, contract);
  }

  // ==================== Event Log ====================

  async appendEvent(event: Omit<PlatformEvent, 'ts'>): Promise<void> {
    const fullEvent: PlatformEvent = {
      ts: new Date().toISOString(),
      ...event,
    };
    const eventLogPath = path.join(this.basePath, 'events/event-log.jsonl');
    await fs.mkdir(path.dirname(eventLogPath), { recursive: true });
    await fs.appendFile(eventLogPath, JSON.stringify(fullEvent) + '\n', 'utf-8');
  }

  async getRecentEvents(limit: number = 100): Promise<PlatformEvent[]> {
    const eventLogPath = path.join(this.basePath, 'events/event-log.jsonl');
    try {
      const content = await fs.readFile(eventLogPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const events = lines.map(line => JSON.parse(line) as PlatformEvent);
      return events.slice(-limit);
    } catch {
      return [];
    }
  }

  async getEventsByType(type: EventType, limit: number = 50): Promise<PlatformEvent[]> {
    const events = await this.getRecentEvents(1000);
    return events.filter(e => e.type === type).slice(-limit);
  }

  // ==================== Initialization ====================

  async initializePlatform(): Promise<void> {
    const dirs = [
      'backlog/stories',
      'sprints',
      'reviews',
      'agents/heartbeats',
      'events',
      'generated',
      'skills',
      'contracts',
      'prompts',
      'schemas',
    ];

    for (const dir of dirs) {
      await fs.mkdir(path.join(this.basePath, dir), { recursive: true });
    }

    // Initialize agent registry if not exists
    const registry = await this.getAgentRegistry();
    if (!registry) {
      await this.updateAgentRegistry({
        version: '1.0',
        last_updated: new Date().toISOString(),
        agents: {
          pm: { agent_id: '', pod_name: '', status: 'inactive', started_at: null, completed_at: null },
          scrum_master: { agent_id: '', pod_name: '', status: 'inactive', started_at: null, completed_at: null },
          developers: [],
          reviewers: [],
        },
        active_count: 0,
        total_spawned: 0,
        total_completed: 0,
        total_failed: 0,
      });
    }

    // Initialize backlog index if not exists
    const backlog = await this.getBacklogIndex();
    if (!backlog) {
      await this.updateBacklogIndex({
        version: '1.0',
        last_updated: new Date().toISOString(),
        total_stories: 0,
        stories_by_priority: {
          must_have: [],
          should_have: [],
          could_have: [],
          wont_have: [],
        },
        critical_path: [],
        next_sprint_candidates: [],
      });
    }
  }
}

export const platformState = new PlatformStateService();
