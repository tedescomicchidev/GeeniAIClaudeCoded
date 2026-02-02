/**
 * Multi-Agent Developer Platform - Backend API
 * Express server with WebSocket support for real-time updates
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';

import { PlatformStateService } from './services/platform-state.js';
import { createMarkdownGenerator } from './services/markdown-generator.js';
import { projectRouter } from './routes/project.js';
import { sprintRouter } from './routes/sprint.js';
import { agentRouter } from './routes/agent.js';
import { storyRouter } from './routes/story.js';

// Initialize logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
});

// Initialize services
const platformState = new PlatformStateService(
  process.env.PLATFORM_PATH || '/workspace/.platform'
);
const markdownGenerator = createMarkdownGenerator(platformState);

// Initialize Express app
const app = express();
const server = createServer(app);

// WebSocket server for real-time updates
const wss = new WebSocketServer({ server, path: '/ws/progress' });

// Store connected clients
const clients = new Map<string, { ws: WebSocket; projectId: string }>();

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const clientId = uuidv4();
  const projectId = new URL(req.url || '', 'http://localhost').searchParams.get('projectId') || 'default';

  clients.set(clientId, { ws, projectId });
  logger.info({ clientId, projectId }, 'WebSocket client connected');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      logger.debug({ clientId, data }, 'Received WebSocket message');

      // Handle client messages (e.g., user input responses)
      if (data.type === 'input.response') {
        // Forward to appropriate handler
        handleInputResponse(clientId, data);
      }
    } catch (error) {
      logger.error({ error }, 'Failed to parse WebSocket message');
    }
  });

  ws.on('close', () => {
    clients.delete(clientId);
    logger.info({ clientId }, 'WebSocket client disconnected');
  });

  ws.on('error', (error) => {
    logger.error({ clientId, error }, 'WebSocket error');
    clients.delete(clientId);
  });

  // Send connection confirmation
  ws.send(JSON.stringify({
    type: 'connection.established',
    clientId,
    timestamp: new Date().toISOString(),
  }));
});

// Broadcast message to all clients for a project
export function broadcast(projectId: string, message: object): void {
  const messageStr = JSON.stringify(message);

  for (const [, client] of clients) {
    if (client.projectId === projectId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(messageStr);
    }
  }
}

// Handle input responses from clients
function handleInputResponse(clientId: string, data: { requestId: string; value: string }): void {
  // Store response for the PM agent to retrieve
  // In a production system, this would go through a message queue
  logger.info({ clientId, data }, 'Input response received');
}

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info({ method: req.method, path: req.path }, 'Request');
  next();
});

// Attach services to request
declare global {
  namespace Express {
    interface Request {
      platformState: PlatformStateService;
      markdownGenerator: ReturnType<typeof createMarkdownGenerator>;
      broadcast: (message: object) => void;
    }
  }
}

app.use((req: Request, _res: Response, next: NextFunction) => {
  req.platformState = platformState;
  req.markdownGenerator = markdownGenerator;
  req.broadcast = (message: object) => {
    const projectId = (req.params.projectId || req.body?.projectId || 'default') as string;
    broadcast(projectId, message);
  };
  next();
});

// Health endpoints
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/ready', async (_req: Request, res: Response) => {
  try {
    // Check if platform state is accessible
    await platformState.getConfig();
    res.json({ status: 'ready', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'not ready', timestamp: new Date().toISOString() });
  }
});

// API routes
app.use('/api/project', projectRouter);
app.use('/api/sprints', sprintRouter);
app.use('/api/agents', agentRouter);
app.use('/api/stories', storyRouter);

// Get platform state summary
app.get('/api/status', async (req: Request, res: Response) => {
  try {
    const [project, config, backlogIndex, sprints, heartbeats] = await Promise.all([
      req.platformState.getProject(),
      req.platformState.getConfig(),
      req.platformState.getBacklogIndex(),
      req.platformState.getAllSprints(),
      req.platformState.getAllHeartbeats(),
    ]);

    const activeSprint = sprints.find(s => s.status === 'active');
    const activeAgents = heartbeats.filter(h => h.status === 'running');

    res.json({
      project,
      config: config?.platform,
      backlog: backlogIndex,
      activeSprint,
      activeAgents,
      sprintCount: sprints.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get status');
    res.status(500).json({ error: 'Failed to get status' });
  }
});

// Get recent events
app.get('/api/events', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const events = await req.platformState.getRecentEvents(limit);
    res.json({ events });
  } catch (error) {
    logger.error({ error }, 'Failed to get events');
    res.status(500).json({ error: 'Failed to get events' });
  }
});

// Regenerate markdown summaries
app.post('/api/regenerate-docs', async (req: Request, res: Response) => {
  try {
    await req.markdownGenerator.generateAll();
    res.json({ success: true, message: 'Documentation regenerated' });
  } catch (error) {
    logger.error({ error }, 'Failed to regenerate docs');
    res.status(500).json({ error: 'Failed to regenerate documentation' });
  }
});

// WebSocket endpoint for receiving progress updates from agents
app.post('/api/progress', (req: Request, res: Response) => {
  const { projectId, ...message } = req.body;
  broadcast(projectId || 'default', {
    ...message,
    timestamp: new Date().toISOString(),
  });
  res.json({ success: true });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ error: err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = parseInt(process.env.PORT || '3000', 10);
const WS_PORT = parseInt(process.env.WS_PORT || '3001', 10);

// Initialize platform state
async function init(): Promise<void> {
  try {
    await platformState.initializePlatform();
    logger.info('Platform state initialized');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize platform state');
  }
}

init().then(() => {
  server.listen(PORT, () => {
    logger.info({ port: PORT, wsPort: WS_PORT }, 'Multi-Agent Platform Backend started');
  });
});

export { app, server, platformState, broadcast };
