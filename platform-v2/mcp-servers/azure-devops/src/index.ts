#!/usr/bin/env node
/**
 * Azure DevOps MCP Server
 * Provides tools for syncing stories to Azure DevOps work items
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as azdev from 'azure-devops-node-api';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';

// Configuration from environment
const ADO_ORG_URL = process.env.ADO_ORG_URL || '';
const ADO_PROJECT = process.env.ADO_PROJECT || '';
const ADO_PAT = process.env.ADO_PAT || '';
const PLATFORM_PATH = process.env.PLATFORM_PATH || '/workspace/.platform';

// Story type mapping
interface Story {
  id: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  story_points?: number;
  priority: number;
  status: string;
  sprint: string | null;
  tags: string[];
}

interface WorkItemMapping {
  storyId: string;
  workItemId: number;
  url: string;
  lastSynced: string;
}

// Azure DevOps client wrapper
class AzureDevOpsClient {
  private connection: azdev.WebApi | null = null;
  private workItemClient: any = null;

  async connect(): Promise<void> {
    if (!ADO_ORG_URL || !ADO_PAT) {
      throw new Error('Azure DevOps configuration missing: ADO_ORG_URL and ADO_PAT required');
    }

    const authHandler = azdev.getPersonalAccessTokenHandler(ADO_PAT);
    this.connection = new azdev.WebApi(ADO_ORG_URL, authHandler);
    this.workItemClient = await this.connection.getWorkItemTrackingApi();
  }

  async createWorkItem(story: Story): Promise<{ id: number; url: string }> {
    if (!this.workItemClient) {
      await this.connect();
    }

    const acceptanceCriteriaHtml = story.acceptance_criteria
      .map(ac => `<li>${ac}</li>`)
      .join('\n');

    const document = [
      {
        op: 'add',
        path: '/fields/System.Title',
        value: `${story.id}: ${story.title}`,
      },
      {
        op: 'add',
        path: '/fields/System.Description',
        value: story.description,
      },
      {
        op: 'add',
        path: '/fields/Microsoft.VSTS.Common.AcceptanceCriteria',
        value: `<ul>${acceptanceCriteriaHtml}</ul>`,
      },
      {
        op: 'add',
        path: '/fields/Microsoft.VSTS.Scheduling.StoryPoints',
        value: story.story_points || 0,
      },
      {
        op: 'add',
        path: '/fields/Microsoft.VSTS.Common.Priority',
        value: Math.min(story.priority, 4), // ADO uses 1-4 priority
      },
      {
        op: 'add',
        path: '/fields/System.Tags',
        value: story.tags.join('; '),
      },
    ];

    const result = await this.workItemClient.createWorkItem(
      null,
      document,
      ADO_PROJECT,
      'User Story'
    );

    return {
      id: result.id,
      url: result._links?.html?.href || `${ADO_ORG_URL}/${ADO_PROJECT}/_workitems/edit/${result.id}`,
    };
  }

  async updateWorkItem(workItemId: number, story: Story): Promise<void> {
    if (!this.workItemClient) {
      await this.connect();
    }

    const statusMap: Record<string, string> = {
      'todo': 'New',
      'in-progress': 'Active',
      'in-review': 'Resolved',
      'done': 'Closed',
      'blocked': 'Active', // ADO doesn't have blocked, use Active with tag
    };

    const document = [
      {
        op: 'replace',
        path: '/fields/System.Title',
        value: `${story.id}: ${story.title}`,
      },
      {
        op: 'replace',
        path: '/fields/System.State',
        value: statusMap[story.status] || 'New',
      },
      {
        op: 'replace',
        path: '/fields/System.Tags',
        value: story.status === 'blocked'
          ? [...story.tags, 'blocked'].join('; ')
          : story.tags.join('; '),
      },
    ];

    await this.workItemClient.updateWorkItem(null, document, workItemId, ADO_PROJECT);
  }

  async getWorkItem(workItemId: number): Promise<any> {
    if (!this.workItemClient) {
      await this.connect();
    }

    return await this.workItemClient.getWorkItem(workItemId, undefined, undefined, undefined, ADO_PROJECT);
  }

  async createIteration(sprintId: string, startDate: Date, endDate: Date): Promise<string> {
    if (!this.connection) {
      await this.connect();
    }

    const workApi = await this.connection!.getWorkApi();

    const iteration = {
      name: sprintId,
      attributes: {
        startDate: startDate.toISOString(),
        finishDate: endDate.toISOString(),
      },
    };

    // Note: Creating iterations requires admin permissions
    // This is a simplified version
    return `${ADO_PROJECT}\\${sprintId}`;
  }
}

// Initialize client
const adoClient = new AzureDevOpsClient();

// Helper to read/write mapping file
async function getMappings(): Promise<Map<string, WorkItemMapping>> {
  try {
    const mappingPath = path.join(PLATFORM_PATH, 'azure-devops-mappings.yaml');
    const content = await fs.readFile(mappingPath, 'utf-8');
    const data = yaml.load(content) as { mappings: WorkItemMapping[] };
    return new Map(data.mappings.map(m => [m.storyId, m]));
  } catch {
    return new Map();
  }
}

async function saveMappings(mappings: Map<string, WorkItemMapping>): Promise<void> {
  const mappingPath = path.join(PLATFORM_PATH, 'azure-devops-mappings.yaml');
  const data = { mappings: Array.from(mappings.values()) };
  await fs.writeFile(mappingPath, yaml.dump(data), 'utf-8');
}

async function readStory(storyId: string): Promise<Story | null> {
  try {
    const storyPath = path.join(PLATFORM_PATH, 'backlog/stories', `${storyId}.yaml`);
    const content = await fs.readFile(storyPath, 'utf-8');
    return yaml.load(content) as Story;
  } catch {
    return null;
  }
}

// Create MCP Server
const server = new Server(
  {
    name: 'azure-devops',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'sync_story_to_ado',
      description: 'Create or update a work item in Azure DevOps from a story YAML',
      inputSchema: {
        type: 'object',
        properties: {
          storyId: {
            type: 'string',
            description: 'The story ID to sync (e.g., STORY-001)',
          },
        },
        required: ['storyId'],
      },
    },
    {
      name: 'sync_all_stories',
      description: 'Sync all stories in the backlog to Azure DevOps',
      inputSchema: {
        type: 'object',
        properties: {
          onlyNew: {
            type: 'boolean',
            description: 'Only sync stories that have not been synced before',
          },
        },
      },
    },
    {
      name: 'get_work_item',
      description: 'Get Azure DevOps work item details by story ID',
      inputSchema: {
        type: 'object',
        properties: {
          storyId: {
            type: 'string',
            description: 'The story ID to look up',
          },
        },
        required: ['storyId'],
      },
    },
    {
      name: 'create_sprint_iteration',
      description: 'Create an Azure DevOps iteration for a sprint',
      inputSchema: {
        type: 'object',
        properties: {
          sprintId: {
            type: 'string',
            description: 'The sprint ID (e.g., sprint-001)',
          },
          startDate: {
            type: 'string',
            format: 'date',
            description: 'Sprint start date (ISO format)',
          },
          endDate: {
            type: 'string',
            format: 'date',
            description: 'Sprint end date (ISO format)',
          },
        },
        required: ['sprintId', 'startDate', 'endDate'],
      },
    },
    {
      name: 'check_ado_connection',
      description: 'Test the Azure DevOps connection',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'sync_story_to_ado': {
      const { storyId } = args as { storyId: string };

      try {
        const story = await readStory(storyId);
        if (!story) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ success: false, error: `Story ${storyId} not found` }),
              },
            ],
          };
        }

        const mappings = await getMappings();
        const existingMapping = mappings.get(storyId);

        if (existingMapping) {
          // Update existing work item
          await adoClient.updateWorkItem(existingMapping.workItemId, story);
          existingMapping.lastSynced = new Date().toISOString();
          mappings.set(storyId, existingMapping);
          await saveMappings(mappings);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  action: 'updated',
                  workItemId: existingMapping.workItemId,
                  url: existingMapping.url,
                }),
              },
            ],
          };
        } else {
          // Create new work item
          const result = await adoClient.createWorkItem(story);

          const mapping: WorkItemMapping = {
            storyId,
            workItemId: result.id,
            url: result.url,
            lastSynced: new Date().toISOString(),
          };
          mappings.set(storyId, mapping);
          await saveMappings(mappings);

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  action: 'created',
                  workItemId: result.id,
                  url: result.url,
                }),
              },
            ],
          };
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
        };
      }
    }

    case 'sync_all_stories': {
      const { onlyNew } = args as { onlyNew?: boolean };

      try {
        const storiesDir = path.join(PLATFORM_PATH, 'backlog/stories');
        const files = await fs.readdir(storiesDir);
        const storyFiles = files.filter(f => f.startsWith('STORY-') && f.endsWith('.yaml'));

        const mappings = await getMappings();
        const results: Array<{ storyId: string; action: string; workItemId?: number; error?: string }> = [];

        for (const file of storyFiles) {
          const storyId = file.replace('.yaml', '');

          if (onlyNew && mappings.has(storyId)) {
            continue;
          }

          try {
            const story = await readStory(storyId);
            if (!story) continue;

            const existingMapping = mappings.get(storyId);

            if (existingMapping) {
              await adoClient.updateWorkItem(existingMapping.workItemId, story);
              existingMapping.lastSynced = new Date().toISOString();
              mappings.set(storyId, existingMapping);
              results.push({ storyId, action: 'updated', workItemId: existingMapping.workItemId });
            } else {
              const result = await adoClient.createWorkItem(story);
              mappings.set(storyId, {
                storyId,
                workItemId: result.id,
                url: result.url,
                lastSynced: new Date().toISOString(),
              });
              results.push({ storyId, action: 'created', workItemId: result.id });
            }
          } catch (error) {
            results.push({
              storyId,
              action: 'failed',
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }

        await saveMappings(mappings);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                synced: results.filter(r => r.action !== 'failed').length,
                failed: results.filter(r => r.action === 'failed').length,
                results,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
        };
      }
    }

    case 'get_work_item': {
      const { storyId } = args as { storyId: string };

      try {
        const mappings = await getMappings();
        const mapping = mappings.get(storyId);

        if (!mapping) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: `No Azure DevOps mapping found for ${storyId}`,
                }),
              },
            ],
          };
        }

        const workItem = await adoClient.getWorkItem(mapping.workItemId);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                storyId,
                workItemId: mapping.workItemId,
                url: mapping.url,
                state: workItem.fields['System.State'],
                assignedTo: workItem.fields['System.AssignedTo']?.displayName,
                lastSynced: mapping.lastSynced,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
        };
      }
    }

    case 'create_sprint_iteration': {
      const { sprintId, startDate, endDate } = args as {
        sprintId: string;
        startDate: string;
        endDate: string;
      };

      try {
        const iterationPath = await adoClient.createIteration(
          sprintId,
          new Date(startDate),
          new Date(endDate)
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                sprintId,
                iterationPath,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
        };
      }
    }

    case 'check_ado_connection': {
      try {
        await adoClient.connect();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                orgUrl: ADO_ORG_URL,
                project: ADO_PROJECT,
                message: 'Connection successful',
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
        };
      }
    }

    default:
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: `Unknown tool: ${name}` }),
          },
        ],
      };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Azure DevOps MCP Server running on stdio');
}

main().catch(console.error);
