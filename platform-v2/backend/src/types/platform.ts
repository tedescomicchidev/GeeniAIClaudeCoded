/**
 * Platform Configuration Types
 */

export interface PlatformConfig {
  platform: {
    version: string;
    name: string;
    cli: 'claude-code' | 'github-copilot' | 'codex';
    max_parallel_agents: number;
    container_image: string;
    kubernetes: {
      namespace: string;
      resource_limits: {
        cpu: string;
        memory: string;
        disk: string;
      };
    };
    state_backend: 'local' | 'azure-devops';
    azure_devops?: {
      org: string;
      project: string;
      pat_secret: string;
    };
    cost_tracking: {
      enabled: boolean;
      alert_threshold_usd: number;
      cumulative_limit_usd: number;
    };
    timeouts: {
      agent_heartbeat_seconds: number;
      sprint_max_seconds: number;
      story_max_seconds: number;
    };
    models: {
      pm_agent: 'opus' | 'sonnet' | 'haiku';
      scrum_master: 'opus' | 'sonnet' | 'haiku';
      developer: 'opus' | 'sonnet' | 'haiku';
      reviewer: 'opus' | 'sonnet' | 'haiku';
    };
  };
}

export interface Project {
  id: string;
  name: string;
  description: string;
  idea: string;
  repository: {
    url: string;
    default_branch: string;
    clone_path: string;
  };
  created_at: string;
  updated_at: string;
  status: 'initialized' | 'planning' | 'active' | 'completed' | 'failed';
  current_sprint: string | null;
  total_stories: number;
  completed_stories: number;
  total_cost_usd: number;
  constraints: {
    tech_stack: string[];
    coding_standards: string[];
    testing_requirements: string[];
    deployment_target: string;
  };
}

/**
 * Story Types
 */

export type StoryStatus = 'todo' | 'in-progress' | 'in-review' | 'done' | 'blocked';
export type StoryRelation = 'fix-for' | 'depends-on' | 'blocks' | 'child-of';
export type ResultStatus = 'pass' | 'fail' | null;

export interface LinkedStory {
  id: string;
  relation: StoryRelation;
}

export interface StoryResult {
  status: ResultStatus;
  pr_url: string | null;
  review_notes: string | null;
  failing_checks: string[];
}

export interface Story {
  id: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  story_points?: 1 | 2 | 3 | 5 | 8;
  priority: number;
  status: StoryStatus;
  sprint: string | null;
  branch: string | null;
  dependencies: string[];
  linked_stories: LinkedStory[];
  tags: string[];
  created_at: string;
  updated_at: string;
  agent_assigned: string | null;
  result: StoryResult;
}

/**
 * Sprint Types
 */

export type SprintStatus = 'planning' | 'active' | 'in-review' | 'done';

export interface SprintMetrics {
  stories_completed: number;
  stories_failed: number;
  fix_stories_created: number;
  total_commits: number;
  lines_added: number;
  lines_removed: number;
}

export interface Sprint {
  id: string;
  status: SprintStatus;
  goal: string;
  stories: string[];
  started_at: string | null;
  completed_at: string | null;
  agents_active: number;
  review_id: string | null;
  cost_usd: number;
  metrics?: SprintMetrics;
}

export interface SprintAssignments {
  sprint_id: string;
  assignments: Array<{
    story_id: string;
    agent_id: string;
    branch: string;
    started_at: string;
    status: 'assigned' | 'in-progress' | 'completed' | 'failed';
  }>;
}

/**
 * Review Types
 */

export type ReviewIssueType = 'code-quality' | 'security' | 'test-coverage' | 'ci-failure' | 'conflict';
export type IssueSeverity = 'critical' | 'major' | 'minor';

export interface ReviewIssue {
  type: ReviewIssueType;
  description: string;
  severity: IssueSeverity;
}

export interface StoryReviewResult {
  story_id: string;
  branch: string;
  status: 'pass' | 'fail' | 'conflict';
  merged: boolean;
  merge_commit: string | null;
  issues: ReviewIssue[];
  fix_stories_created: string[];
}

export interface ReviewSummary {
  total_stories: number;
  passed: number;
  failed: number;
  conflicts: number;
  fix_stories_created: number;
}

export interface Review {
  id: string;
  sprint_id: string;
  status: 'in-progress' | 'completed';
  started_at: string;
  completed_at: string | null;
  reviewer_agent_id: string;
  results: StoryReviewResult[];
  summary: ReviewSummary;
}

/**
 * Agent Types
 */

export type AgentRole = 'pm' | 'scrum-master' | 'developer' | 'reviewer';
export type AgentStatus = 'inactive' | 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'blocked';

export interface AgentHeartbeat {
  agent_id: string;
  role: AgentRole;
  story_id: string | null;
  sprint_id: string | null;
  status: AgentStatus;
  current_task?: string;
  progress_percent?: number;
  started_at: string;
  last_heartbeat: string;
  completed_at?: string;
  commits_made?: number;
  tests_passing?: boolean;
  error_message?: string;
}

export interface AgentInfo {
  agent_id: string;
  pod_name: string;
  status: AgentStatus;
  started_at: string | null;
  completed_at: string | null;
}

export interface AgentRegistry {
  version: string;
  last_updated: string;
  agents: {
    pm: AgentInfo;
    scrum_master: AgentInfo;
    developers: AgentInfo[];
    reviewers: AgentInfo[];
  };
  active_count: number;
  total_spawned: number;
  total_completed: number;
  total_failed: number;
}

/**
 * Backlog Index Types
 */

export interface BacklogIndex {
  version: string;
  last_updated: string;
  total_stories: number;
  stories_by_priority: {
    must_have: string[];
    should_have: string[];
    could_have: string[];
    wont_have: string[];
  };
  critical_path: string[];
  next_sprint_candidates: string[];
}

/**
 * Event Types
 */

export type EventType =
  | 'project.created'
  | 'project.updated'
  | 'project.completed'
  | 'planning.started'
  | 'planning.completed'
  | 'planning.revised'
  | 'sprint.planned'
  | 'sprint.started'
  | 'sprint.completed'
  | 'sprint.failed'
  | 'agent.spawned'
  | 'agent.heartbeat'
  | 'agent.completed'
  | 'agent.failed'
  | 'agent.timeout'
  | 'agent.terminated'
  | 'story.started'
  | 'story.completed'
  | 'story.failed'
  | 'story.blocked'
  | 'review.started'
  | 'review.completed'
  | 'merge.success'
  | 'merge.conflict'
  | 'ci.passed'
  | 'ci.failed'
  | 'cost.threshold'
  | 'error';

export interface PlatformEvent {
  ts: string;
  type: EventType;
  data?: Record<string, unknown>;
  agent_id?: string;
  sprint_id?: string;
  story_id?: string;
}

/**
 * Contract Types
 */

export interface InterfaceExport {
  type: string;
  path: string;
  contract: string;
}

export interface InterfaceContract {
  story_id: string;
  exports: InterfaceExport[];
}
