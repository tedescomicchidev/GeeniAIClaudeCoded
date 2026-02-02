#!/usr/bin/env node
/**
 * Agent Launcher MCP Server
 * Provides tools for launching, monitoring, and terminating agent pods in Kubernetes
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as k8s from '@kubernetes/client-node';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { v4 as uuidv4 } from 'uuid';

// Initialize Kubernetes client
const kc = new k8s.KubeConfig();
kc.loadFromDefault();
const k8sBatch = kc.makeApiClient(k8s.BatchV1Api);
const k8sCore = kc.makeApiClient(k8s.CoreV1Api);

// Configuration
const NAMESPACE = process.env.K8S_NAMESPACE || 'agent-platform';
const CONTAINER_IMAGE = process.env.AGENT_IMAGE || 'ghcr.io/platform/agent-runner:latest';
const PLATFORM_PATH = process.env.PLATFORM_PATH || '/workspace/.platform';

// Types
interface SpawnAgentArgs {
  role: 'developer' | 'reviewer' | 'scrum-master' | 'pm';
  storyId?: string;
  sprintId: string;
  branchName?: string;
  cliTool?: 'claude-code' | 'github-copilot' | 'codex';
  systemPrompt?: string;
}

interface AgentHeartbeat {
  agent_id: string;
  role: string;
  story_id: string | null;
  sprint_id: string | null;
  status: string;
  current_task?: string;
  progress_percent?: number;
  started_at: string;
  last_heartbeat: string;
  completed_at?: string;
  error_message?: string;
}

/**
 * Generate Kubernetes Job manifest for an agent
 */
function generateJobManifest(args: SpawnAgentArgs & { agentId: string }): k8s.V1Job {
  const jobName = `agent-${args.role}-${args.storyId || args.sprintId}-${args.agentId.slice(0, 8)}`;

  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name: jobName,
      namespace: NAMESPACE,
      labels: {
        'platform.role': args.role,
        'platform.sprint': args.sprintId,
        'platform.story': args.storyId || '',
        'platform.agent-id': args.agentId,
      },
    },
    spec: {
      backoffLimit: 1,
      activeDeadlineSeconds: 3600, // 1 hour timeout
      template: {
        metadata: {
          labels: {
            'platform.role': args.role,
            'platform.sprint': args.sprintId,
            'platform.agent-id': args.agentId,
          },
        },
        spec: {
          restartPolicy: 'Never',
          volumes: [
            {
              name: 'repo-volume',
              persistentVolumeClaim: {
                claimName: `sprint-${args.sprintId}-repo`,
              },
            },
            {
              name: 'platform-state',
              persistentVolumeClaim: {
                claimName: 'platform-state',
              },
            },
          ],
          containers: [
            {
              name: 'agent',
              image: CONTAINER_IMAGE,
              resources: {
                requests: {
                  cpu: '500m',
                  memory: '1Gi',
                },
                limits: {
                  cpu: '1',
                  memory: '2Gi',
                  'ephemeral-storage': '10Gi',
                },
              },
              env: [
                { name: 'AGENT_ROLE', value: args.role },
                { name: 'AGENT_ID', value: args.agentId },
                { name: 'STORY_ID', value: args.storyId || '' },
                { name: 'SPRINT_ID', value: args.sprintId },
                { name: 'BRANCH_NAME', value: args.branchName || '' },
                { name: 'CLI_TOOL', value: args.cliTool || 'claude-code' },
                {
                  name: 'ANTHROPIC_API_KEY',
                  valueFrom: {
                    secretKeyRef: {
                      name: 'agent-secrets',
                      key: 'anthropic-api-key',
                    },
                  },
                },
              ],
              volumeMounts: [
                {
                  name: 'repo-volume',
                  mountPath: '/workspace/repo',
                },
                {
                  name: 'platform-state',
                  mountPath: '/workspace/.platform',
                },
              ],
            },
          ],
        },
      },
    },
  };
}

/**
 * Read agent heartbeat from .platform/agents/heartbeats/
 */
async function readHeartbeat(agentId: string): Promise<AgentHeartbeat | null> {
  try {
    const heartbeatPath = path.join(PLATFORM_PATH, 'agents/heartbeats', `${agentId}.yaml`);
    const content = await fs.readFile(heartbeatPath, 'utf-8');
    return yaml.load(content) as AgentHeartbeat;
  } catch {
    return null;
  }
}

/**
 * Get Job status from Kubernetes
 */
async function getJobStatus(jobName: string): Promise<{
  status: string;
  podName?: string;
  message?: string;
}> {
  try {
    const job = await k8sBatch.readNamespacedJob(jobName, NAMESPACE);
    const status = job.body.status;

    if (status?.succeeded && status.succeeded > 0) {
      return { status: 'completed' };
    }
    if (status?.failed && status.failed > 0) {
      return { status: 'failed', message: 'Job execution failed' };
    }
    if (status?.active && status.active > 0) {
      // Get pod name
      const pods = await k8sCore.listNamespacedPod(
        NAMESPACE,
        undefined,
        undefined,
        undefined,
        undefined,
        `job-name=${jobName}`
      );
      const podName = pods.body.items[0]?.metadata?.name;
      return { status: 'running', podName };
    }
    return { status: 'pending' };
  } catch {
    return { status: 'unknown', message: 'Failed to get job status' };
  }
}

// Create MCP Server
const server = new Server(
  {
    name: 'agent-launcher',
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
      name: 'spawn_agent',
      description: 'Launch a new developer/reviewer/scrum-master agent in a Kubernetes pod',
      inputSchema: {
        type: 'object',
        properties: {
          role: {
            type: 'string',
            enum: ['developer', 'reviewer', 'scrum-master', 'pm'],
            description: 'The role of the agent to spawn',
          },
          storyId: {
            type: 'string',
            description: 'The story ID for developer agents (e.g., STORY-001)',
          },
          sprintId: {
            type: 'string',
            description: 'The sprint ID (e.g., sprint-001)',
          },
          branchName: {
            type: 'string',
            description: 'The git branch name for developer agents',
          },
          cliTool: {
            type: 'string',
            enum: ['claude-code', 'github-copilot', 'codex'],
            description: 'The CLI tool to use for the agent',
          },
          systemPrompt: {
            type: 'string',
            description: 'Optional custom system prompt override',
          },
        },
        required: ['role', 'sprintId'],
      },
    },
    {
      name: 'check_agent_status',
      description: 'Check the status of an agent pod by reading its heartbeat file and K8s job status',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: {
            type: 'string',
            description: 'The agent ID to check',
          },
        },
        required: ['agentId'],
      },
    },
    {
      name: 'terminate_agent',
      description: 'Terminate a stuck or failed agent pod',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: {
            type: 'string',
            description: 'The agent ID to terminate',
          },
          reason: {
            type: 'string',
            description: 'Reason for termination',
          },
        },
        required: ['agentId'],
      },
    },
    {
      name: 'list_agents',
      description: 'List all agent pods for a sprint',
      inputSchema: {
        type: 'object',
        properties: {
          sprintId: {
            type: 'string',
            description: 'The sprint ID to filter by',
          },
          status: {
            type: 'string',
            enum: ['all', 'running', 'completed', 'failed'],
            description: 'Filter by status',
          },
        },
        required: ['sprintId'],
      },
    },
    {
      name: 'wait_for_agents',
      description: 'Wait for all agents in a sprint to complete',
      inputSchema: {
        type: 'object',
        properties: {
          sprintId: {
            type: 'string',
            description: 'The sprint ID to wait for',
          },
          timeoutSeconds: {
            type: 'number',
            description: 'Maximum time to wait in seconds',
          },
        },
        required: ['sprintId'],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'spawn_agent': {
      const typedArgs = args as unknown as SpawnAgentArgs;
      const agentId = `agent-${typedArgs.role}-${uuidv4().slice(0, 8)}`;

      try {
        const jobManifest = generateJobManifest({ ...typedArgs, agentId });
        const result = await k8sBatch.createNamespacedJob(NAMESPACE, jobManifest);

        // Write initial heartbeat
        const heartbeat: AgentHeartbeat = {
          agent_id: agentId,
          role: typedArgs.role,
          story_id: typedArgs.storyId || null,
          sprint_id: typedArgs.sprintId,
          status: 'pending',
          started_at: new Date().toISOString(),
          last_heartbeat: new Date().toISOString(),
        };

        const heartbeatPath = path.join(PLATFORM_PATH, 'agents/heartbeats', `${agentId}.yaml`);
        await fs.mkdir(path.dirname(heartbeatPath), { recursive: true });
        await fs.writeFile(heartbeatPath, yaml.dump(heartbeat), 'utf-8');

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                agentId,
                jobName: result.body.metadata?.name,
                status: 'launched',
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

    case 'check_agent_status': {
      const { agentId } = args as { agentId: string };

      try {
        // Read heartbeat file
        const heartbeat = await readHeartbeat(agentId);

        // Get K8s job status
        const jobs = await k8sBatch.listNamespacedJob(
          NAMESPACE,
          undefined,
          undefined,
          undefined,
          undefined,
          `platform.agent-id=${agentId}`
        );

        let k8sStatus = 'unknown';
        let podName: string | undefined;

        if (jobs.body.items.length > 0) {
          const jobStatus = await getJobStatus(jobs.body.items[0].metadata?.name || '');
          k8sStatus = jobStatus.status;
          podName = jobStatus.podName;
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                agentId,
                heartbeat,
                k8sStatus,
                podName,
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

    case 'terminate_agent': {
      const { agentId, reason } = args as { agentId: string; reason?: string };

      try {
        // Find and delete the job
        const jobs = await k8sBatch.listNamespacedJob(
          NAMESPACE,
          undefined,
          undefined,
          undefined,
          undefined,
          `platform.agent-id=${agentId}`
        );

        if (jobs.body.items.length > 0) {
          const jobName = jobs.body.items[0].metadata?.name;
          if (jobName) {
            await k8sBatch.deleteNamespacedJob(
              jobName,
              NAMESPACE,
              undefined,
              undefined,
              undefined,
              undefined,
              'Background'
            );
          }
        }

        // Update heartbeat
        const heartbeatPath = path.join(PLATFORM_PATH, 'agents/heartbeats', `${agentId}.yaml`);
        const heartbeat = await readHeartbeat(agentId);
        if (heartbeat) {
          heartbeat.status = 'terminated';
          heartbeat.error_message = reason || 'Manually terminated';
          heartbeat.completed_at = new Date().toISOString();
          await fs.writeFile(heartbeatPath, yaml.dump(heartbeat), 'utf-8');
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                status: 'terminated',
                reason,
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

    case 'list_agents': {
      const { sprintId, status } = args as { sprintId: string; status?: string };

      try {
        const jobs = await k8sBatch.listNamespacedJob(
          NAMESPACE,
          undefined,
          undefined,
          undefined,
          undefined,
          `platform.sprint=${sprintId}`
        );

        const agents = await Promise.all(
          jobs.body.items.map(async (job) => {
            const agentId = job.metadata?.labels?.['platform.agent-id'];
            const heartbeat = agentId ? await readHeartbeat(agentId) : null;
            const jobStatus = await getJobStatus(job.metadata?.name || '');

            return {
              agentId,
              jobName: job.metadata?.name,
              role: job.metadata?.labels?.['platform.role'],
              storyId: job.metadata?.labels?.['platform.story'],
              status: heartbeat?.status || jobStatus.status,
              heartbeat,
            };
          })
        );

        // Filter by status if specified
        const filteredAgents = status && status !== 'all'
          ? agents.filter(a => a.status === status)
          : agents;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                sprintId,
                count: filteredAgents.length,
                agents: filteredAgents,
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

    case 'wait_for_agents': {
      const { sprintId, timeoutSeconds = 3600 } = args as {
        sprintId: string;
        timeoutSeconds?: number;
      };

      const startTime = Date.now();
      const timeout = timeoutSeconds * 1000;

      try {
        while (Date.now() - startTime < timeout) {
          const jobs = await k8sBatch.listNamespacedJob(
            NAMESPACE,
            undefined,
            undefined,
            undefined,
            undefined,
            `platform.sprint=${sprintId}`
          );

          const statuses = await Promise.all(
            jobs.body.items.map(async (job) => {
              const status = await getJobStatus(job.metadata?.name || '');
              return status.status;
            })
          );

          const allComplete = statuses.every(s => s === 'completed' || s === 'failed');

          if (allComplete) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    status: 'all_complete',
                    completed: statuses.filter(s => s === 'completed').length,
                    failed: statuses.filter(s => s === 'failed').length,
                  }),
                },
              ],
            };
          }

          // Wait 10 seconds before checking again
          await new Promise(resolve => setTimeout(resolve, 10000));
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                status: 'timeout',
                message: `Timeout after ${timeoutSeconds} seconds`,
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
  console.error('Agent Launcher MCP Server running on stdio');
}

main().catch(console.error);
