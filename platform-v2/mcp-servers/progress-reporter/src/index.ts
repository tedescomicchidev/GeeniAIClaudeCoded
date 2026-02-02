#!/usr/bin/env node
/**
 * Progress Reporter MCP Server
 * Provides tools for sending progress updates to the UI via WebSocket
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import WebSocket from 'ws';

// Configuration
const WS_URL = process.env.PROGRESS_WS_URL || 'ws://localhost:3001/ws/progress';
const PROJECT_ID = process.env.PROJECT_ID || 'default';

// WebSocket client with auto-reconnect
class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000;
  private messageQueue: string[] = [];

  constructor(url: string) {
    this.url = url;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.on('open', () => {
          console.error(`Connected to WebSocket: ${this.url}`);
          this.reconnectAttempts = 0;

          // Send queued messages
          while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift();
            if (msg && this.ws?.readyState === WebSocket.OPEN) {
              this.ws.send(msg);
            }
          }

          resolve();
        });

        this.ws.on('close', () => {
          console.error('WebSocket connection closed');
          this.ws = null;
          this.attemptReconnect();
        });

        this.ws.on('error', (error) => {
          console.error('WebSocket error:', error.message);
          if (this.reconnectAttempts === 0) {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.error(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    await new Promise(resolve => setTimeout(resolve, delay));
    try {
      await this.connect();
    } catch {
      // Will retry via close handler
    }
  }

  async send(message: object): Promise<boolean> {
    const msgStr = JSON.stringify(message);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msgStr);
      return true;
    }

    // Queue message for when connection is restored
    this.messageQueue.push(msgStr);

    // Attempt to connect if not already
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      try {
        await this.connect();
      } catch {
        // Connection will be retried
      }
    }

    return false;
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Initialize WebSocket client
const wsClient = new WebSocketClient(WS_URL);

// Progress event types
type ProgressEventType =
  | 'project.update'
  | 'planning.progress'
  | 'sprint.progress'
  | 'story.progress'
  | 'agent.status'
  | 'review.progress'
  | 'cost.update'
  | 'error'
  | 'info'
  | 'chat.message';

interface ProgressEvent {
  type: ProgressEventType;
  projectId: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

// Create MCP Server
const server = new Server(
  {
    name: 'progress-reporter',
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
      name: 'report_progress',
      description: 'Send a progress update to the user interface',
      inputSchema: {
        type: 'object',
        properties: {
          eventType: {
            type: 'string',
            enum: [
              'project.update',
              'planning.progress',
              'sprint.progress',
              'story.progress',
              'agent.status',
              'review.progress',
              'cost.update',
              'error',
              'info',
              'chat.message',
            ],
            description: 'The type of progress event',
          },
          message: {
            type: 'string',
            description: 'Human-readable message to display',
          },
          data: {
            type: 'object',
            description: 'Additional data payload for the event',
          },
        },
        required: ['eventType', 'message'],
      },
    },
    {
      name: 'send_chat_message',
      description: 'Send a chat message from the agent to the user',
      inputSchema: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'The chat message to send',
          },
          agentRole: {
            type: 'string',
            enum: ['pm', 'scrum-master', 'developer', 'reviewer'],
            description: 'Which agent is sending the message',
          },
        },
        required: ['message'],
      },
    },
    {
      name: 'update_dashboard',
      description: 'Send a dashboard state update to the UI',
      inputSchema: {
        type: 'object',
        properties: {
          sprintProgress: {
            type: 'object',
            properties: {
              sprintId: { type: 'string' },
              totalStories: { type: 'number' },
              completedStories: { type: 'number' },
              inProgressStories: { type: 'number' },
              failedStories: { type: 'number' },
            },
          },
          activeAgents: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                agentId: { type: 'string' },
                role: { type: 'string' },
                storyId: { type: 'string' },
                status: { type: 'string' },
                progress: { type: 'number' },
              },
            },
          },
          overallProgress: {
            type: 'object',
            properties: {
              totalStories: { type: 'number' },
              completedStories: { type: 'number' },
              totalCostUsd: { type: 'number' },
            },
          },
        },
        required: [],
      },
    },
    {
      name: 'request_user_input',
      description: 'Request input or confirmation from the user',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'The question or prompt to show the user',
          },
          inputType: {
            type: 'string',
            enum: ['text', 'confirm', 'select'],
            description: 'Type of input requested',
          },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: 'Options for select type input',
          },
          defaultValue: {
            type: 'string',
            description: 'Default value for the input',
          },
        },
        required: ['prompt', 'inputType'],
      },
    },
  ],
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'report_progress': {
      const { eventType, message, data } = args as {
        eventType: ProgressEventType;
        message: string;
        data?: Record<string, unknown>;
      };

      const event: ProgressEvent = {
        type: eventType,
        projectId: PROJECT_ID,
        message,
        data,
        timestamp: new Date().toISOString(),
      };

      const delivered = await wsClient.send(event);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              delivered,
              event,
            }),
          },
        ],
      };
    }

    case 'send_chat_message': {
      const { message, agentRole } = args as {
        message: string;
        agentRole?: string;
      };

      const event: ProgressEvent = {
        type: 'chat.message',
        projectId: PROJECT_ID,
        message,
        data: {
          sender: agentRole || 'pm',
          isAgent: true,
        },
        timestamp: new Date().toISOString(),
      };

      const delivered = await wsClient.send(event);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              delivered,
            }),
          },
        ],
      };
    }

    case 'update_dashboard': {
      const dashboardData = args as Record<string, unknown>;

      const event = {
        type: 'dashboard.update',
        projectId: PROJECT_ID,
        message: 'Dashboard update',
        data: dashboardData,
        timestamp: new Date().toISOString(),
      };

      const delivered = await wsClient.send(event);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              delivered,
            }),
          },
        ],
      };
    }

    case 'request_user_input': {
      const { prompt, inputType, options, defaultValue } = args as {
        prompt: string;
        inputType: 'text' | 'confirm' | 'select';
        options?: string[];
        defaultValue?: string;
      };

      const event = {
        type: 'input.request',
        projectId: PROJECT_ID,
        message: prompt,
        data: {
          inputType,
          options,
          defaultValue,
          requestId: `input-${Date.now()}`,
        },
        timestamp: new Date().toISOString(),
      };

      const delivered = await wsClient.send(event);

      // Note: Actual input response would come back via another channel
      // This is a one-way notification for now

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              delivered,
              message: 'Input request sent. User response will be provided separately.',
            }),
          },
        ],
      };
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
  // Try to connect to WebSocket (non-blocking)
  wsClient.connect().catch(() => {
    console.error('Initial WebSocket connection failed, will retry');
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Progress Reporter MCP Server running on stdio');
}

main().catch(console.error);
