/**
 * Markdown Generator Service
 * Generates human-readable Markdown summaries from platform state
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  Project,
  Story,
  Sprint,
  Review,
  BacklogIndex,
  AgentHeartbeat,
} from '../types/platform.js';
import { PlatformStateService } from './platform-state.js';

export class MarkdownGeneratorService {
  private stateService: PlatformStateService;
  private basePath: string;

  constructor(stateService: PlatformStateService, basePath: string = '/workspace/.platform') {
    this.stateService = stateService;
    this.basePath = basePath;
  }

  /**
   * Write a Markdown file
   */
  private async writeMarkdown(filename: string, content: string): Promise<void> {
    const fullPath = path.join(this.basePath, 'generated', filename);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  /**
   * Generate all Markdown summaries
   */
  async generateAll(): Promise<void> {
    await Promise.all([
      this.generateBacklogMarkdown(),
      this.generateProgressMarkdown(),
      this.generateCurrentSprintMarkdown(),
    ]);
  }

  /**
   * Generate backlog.md - Human-readable backlog
   */
  async generateBacklogMarkdown(): Promise<void> {
    const stories = await this.stateService.getAllStories();
    const index = await this.stateService.getBacklogIndex();

    let md = `# Product Backlog

*Generated: ${new Date().toISOString()}*

## Summary

- **Total Stories**: ${stories.length}
- **Completed**: ${stories.filter(s => s.status === 'done').length}
- **In Progress**: ${stories.filter(s => s.status === 'in-progress').length}
- **Blocked**: ${stories.filter(s => s.status === 'blocked').length}
- **Todo**: ${stories.filter(s => s.status === 'todo').length}

---

## Must Have (Priority 1-3)

${this.renderStoryList(stories, index?.stories_by_priority.must_have || [])}

## Should Have (Priority 4-6)

${this.renderStoryList(stories, index?.stories_by_priority.should_have || [])}

## Could Have (Priority 7-9)

${this.renderStoryList(stories, index?.stories_by_priority.could_have || [])}

## Won't Have (Priority 10+)

${this.renderStoryList(stories, index?.stories_by_priority.wont_have || [])}

---

## Completed Stories

${this.renderCompletedStories(stories)}

---

## Critical Path

The following stories block the most other stories:

${index?.critical_path.map((id, i) => `${i + 1}. ${id}`).join('\n') || '_No critical path identified_'}

## Ready for Next Sprint

Stories with all dependencies met:

${index?.next_sprint_candidates.map(id => `- ${id}`).join('\n') || '_No stories ready_'}
`;

    await this.writeMarkdown('backlog.md', md);
  }

  private renderStoryList(stories: Story[], ids: string[]): string {
    if (ids.length === 0) return '_No stories in this category_\n';

    return ids.map(id => {
      const story = stories.find(s => s.id === id);
      if (!story) return `- ${id} (not found)`;

      const statusEmoji = this.getStatusEmoji(story.status);
      const points = story.story_points ? `[${story.story_points}pts]` : '';
      const deps = story.dependencies.length > 0
        ? ` ← depends on: ${story.dependencies.join(', ')}`
        : '';

      return `### ${statusEmoji} ${story.id}: ${story.title} ${points}

**Priority**: ${story.priority} | **Status**: ${story.status} | **Tags**: ${story.tags.join(', ') || 'none'}${deps}

${story.description.split('\n').slice(0, 3).join('\n')}

**Acceptance Criteria**:
${story.acceptance_criteria.map(ac => `- [ ] ${ac}`).join('\n')}

---
`;
    }).join('\n');
  }

  private renderCompletedStories(stories: Story[]): string {
    const completed = stories.filter(s => s.status === 'done');
    if (completed.length === 0) return '_No completed stories_\n';

    return completed.map(story => {
      const result = story.result.status === 'pass' ? '✅' : '❌';
      return `- ${result} **${story.id}**: ${story.title} (Sprint: ${story.sprint || 'N/A'})`;
    }).join('\n');
  }

  private getStatusEmoji(status: string): string {
    const emojis: Record<string, string> = {
      'todo': '📋',
      'in-progress': '🔄',
      'in-review': '🔍',
      'done': '✅',
      'blocked': '🚫',
    };
    return emojis[status] || '❓';
  }

  /**
   * Generate progress.md - Overall progress dashboard
   */
  async generateProgressMarkdown(): Promise<void> {
    const project = await this.stateService.getProject();
    const stories = await this.stateService.getAllStories();
    const sprints = await this.stateService.getAllSprints();
    const heartbeats = await this.stateService.getAllHeartbeats();

    const totalStories = stories.length;
    const doneStories = stories.filter(s => s.status === 'done').length;
    const progressPercent = totalStories > 0 ? Math.round((doneStories / totalStories) * 100) : 0;
    const progressBar = this.renderProgressBar(progressPercent);

    const activeSprint = sprints.find(s => s.status === 'active');
    const activeAgents = heartbeats.filter(h => h.status === 'running');

    let md = `# Project Progress Dashboard

*Generated: ${new Date().toISOString()}*

## Project: ${project?.name || 'Unnamed Project'}

**Status**: ${project?.status || 'unknown'}
**Total Cost**: $${(project?.total_cost_usd || 0).toFixed(2)} USD

---

## Overall Progress

${progressBar}

**${doneStories}** of **${totalStories}** stories completed (${progressPercent}%)

| Status | Count |
|--------|-------|
| ✅ Done | ${stories.filter(s => s.status === 'done').length} |
| 🔄 In Progress | ${stories.filter(s => s.status === 'in-progress').length} |
| 🔍 In Review | ${stories.filter(s => s.status === 'in-review').length} |
| 🚫 Blocked | ${stories.filter(s => s.status === 'blocked').length} |
| 📋 Todo | ${stories.filter(s => s.status === 'todo').length} |

---

## Current Sprint

${activeSprint ? this.renderSprintSummary(activeSprint, stories) : '_No active sprint_'}

---

## Active Agents

${activeAgents.length > 0 ? this.renderActiveAgents(activeAgents) : '_No active agents_'}

---

## Sprint History

${this.renderSprintHistory(sprints)}

---

## Story Points Burndown

${this.renderBurndown(stories, sprints)}
`;

    await this.writeMarkdown('progress.md', md);
  }

  private renderProgressBar(percent: number): string {
    const filled = Math.round(percent / 5);
    const empty = 20 - filled;
    return `\`[${'█'.repeat(filled)}${'░'.repeat(empty)}]\` ${percent}%`;
  }

  private renderSprintSummary(sprint: Sprint, stories: Story[]): string {
    const sprintStories = stories.filter(s => sprint.stories.includes(s.id));
    const done = sprintStories.filter(s => s.status === 'done').length;
    const total = sprintStories.length;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;

    return `### ${sprint.id}

**Goal**: ${sprint.goal}
**Status**: ${sprint.status}
**Progress**: ${done}/${total} stories (${percent}%)
**Active Agents**: ${sprint.agents_active}
**Started**: ${sprint.started_at || 'Not started'}

#### Stories in Sprint

${sprintStories.map(s => {
  const emoji = this.getStatusEmoji(s.status);
  const agent = s.agent_assigned ? ` (Agent: ${s.agent_assigned})` : '';
  return `- ${emoji} ${s.id}: ${s.title}${agent}`;
}).join('\n')}
`;
  }

  private renderActiveAgents(agents: AgentHeartbeat[]): string {
    return agents.map(agent => {
      const progress = agent.progress_percent !== undefined
        ? ` [${agent.progress_percent}%]`
        : '';
      return `| 🤖 ${agent.agent_id} | ${agent.role} | ${agent.story_id || 'N/A'} | ${agent.current_task || 'Working...'}${progress} |`;
    }).join('\n') + '\n\n| Agent | Role | Story | Task |' + '\n|-------|------|-------|------|';
  }

  private renderSprintHistory(sprints: Sprint[]): string {
    if (sprints.length === 0) return '_No sprints yet_';

    return `| Sprint | Status | Stories | Started | Completed |
|--------|--------|---------|---------|-----------|
${sprints.map(s => {
  return `| ${s.id} | ${s.status} | ${s.stories.length} | ${s.started_at?.split('T')[0] || '-'} | ${s.completed_at?.split('T')[0] || '-'} |`;
}).join('\n')}
`;
  }

  private renderBurndown(stories: Story[], sprints: Sprint[]): string {
    const totalPoints = stories.reduce((sum, s) => sum + (s.story_points || 0), 0);
    const donePoints = stories
      .filter(s => s.status === 'done')
      .reduce((sum, s) => sum + (s.story_points || 0), 0);
    const remainingPoints = totalPoints - donePoints;

    return `**Total Story Points**: ${totalPoints}
**Completed Points**: ${donePoints}
**Remaining Points**: ${remainingPoints}

${this.renderProgressBar(totalPoints > 0 ? Math.round((donePoints / totalPoints) * 100) : 0)} Story Points
`;
  }

  /**
   * Generate sprint-specific Markdown
   */
  async generateCurrentSprintMarkdown(): Promise<void> {
    const sprints = await this.stateService.getAllSprints();
    const activeSprint = sprints.find(s => s.status === 'active' || s.status === 'in-review');

    if (!activeSprint) return;

    const stories = await this.stateService.getAllStories();
    const sprintStories = stories.filter(s => activeSprint.stories.includes(s.id));
    const review = activeSprint.review_id
      ? await this.stateService.getReview(activeSprint.review_id)
      : null;

    let md = `# ${activeSprint.id} Summary

*Generated: ${new Date().toISOString()}*

## Sprint Goal

${activeSprint.goal}

## Status: ${activeSprint.status.toUpperCase()}

- **Started**: ${activeSprint.started_at || 'Not started'}
- **Completed**: ${activeSprint.completed_at || 'In progress'}
- **Cost**: $${activeSprint.cost_usd.toFixed(2)} USD

---

## Stories

${sprintStories.map(story => {
  const emoji = this.getStatusEmoji(story.status);
  const result = story.result.status ? ` → ${story.result.status.toUpperCase()}` : '';

  return `### ${emoji} ${story.id}: ${story.title}${result}

**Branch**: \`${story.branch || 'Not created'}\`
**Agent**: ${story.agent_assigned || 'Unassigned'}
**Status**: ${story.status}

**Acceptance Criteria**:
${story.acceptance_criteria.map(ac => {
  const checked = story.status === 'done' ? '[x]' : '[ ]';
  return `- ${checked} ${ac}`;
}).join('\n')}

${story.result.review_notes ? `**Review Notes**: ${story.result.review_notes}` : ''}

---
`;
}).join('\n')}

${review ? this.renderReviewSection(review) : ''}
`;

    await this.writeMarkdown(`${activeSprint.id}.md`, md);
  }

  private renderReviewSection(review: Review): string {
    return `## Review Results

**Reviewer**: ${review.reviewer_agent_id}
**Status**: ${review.status}

### Summary

| Metric | Count |
|--------|-------|
| Total Stories | ${review.summary.total_stories} |
| Passed | ${review.summary.passed} |
| Failed | ${review.summary.failed} |
| Conflicts | ${review.summary.conflicts} |
| Fix Stories Created | ${review.summary.fix_stories_created} |

### Details

${review.results.map(r => {
  const emoji = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '⚠️';
  const issues = r.issues.length > 0
    ? `\n  - Issues: ${r.issues.map(i => `${i.severity}: ${i.description}`).join('; ')}`
    : '';
  const fixes = r.fix_stories_created.length > 0
    ? `\n  - Fix stories: ${r.fix_stories_created.join(', ')}`
    : '';
  return `- ${emoji} **${r.story_id}** (${r.branch}): ${r.status}${r.merged ? ' → merged' : ''}${issues}${fixes}`;
}).join('\n')}
`;
  }
}

export function createMarkdownGenerator(stateService: PlatformStateService): MarkdownGeneratorService {
  return new MarkdownGeneratorService(stateService);
}
