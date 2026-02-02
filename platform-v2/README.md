# Multi-Agent Developer Platform V2

A **multi-agent developer platform** that lets users describe an application idea through a chat UI, then automatically breaks the idea down into user stories (scrum-style), orchestrates parallel coding agents that each work in isolated git branches/worktrees (one agent per Kubernetes container), reviews and merges their output, and continuously reports progress back to the user.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                       CHAT UI (Frontend)                            │
│  Next.js / React · WebSocket for real-time progress · User input    │
└────────────────────────────┬────────────────────────────────────────┘
                             │ WebSocket / REST
┌────────────────────────────▼────────────────────────────────────────┐
│                    BACKEND API (Node.js)                             │
│  • Accepts user idea + config (agent count, CLI preference)         │
│  • Spawns PM Agent container in Kubernetes                          │
│  • Proxies progress events from PM → UI via WebSocket               │
│  • Serves .platform/ state to the UI for dashboard rendering        │
└────────────────────────────┬────────────────────────────────────────┘
                             │ K8s Job / Pod creation
┌────────────────────────────▼────────────────────────────────────────┐
│                PM (PROJECT MANAGER) AGENT                            │
│  Runs in its own K8s pod                                            │
│  CLI: claude-code | github-copilot | codex (user-selectable)        │
│  Role: Orchestrator — owns the main branch, delegates sprints       │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Scrum Master  │  │  Developer   │  │     Reviewer Agent       │  │
│  │    Agent      │  │   Agent(s)   │  │  (spawned after sprint)  │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Features

- **Chat-based Interface**: Describe your app idea in natural language
- **Automatic Story Generation**: Scrum Master agent breaks down ideas into user stories
- **Parallel Development**: Multiple developer agents work simultaneously on different stories
- **Git Isolation**: Each agent works in its own git worktree/branch
- **Automated Review**: Reviewer agent checks code quality, runs tests, and merges
- **Real-time Progress**: WebSocket-based updates to the dashboard
- **Cost Tracking**: Monitor API usage costs across all agents
- **Azure DevOps Integration**: Optional sync to Azure DevOps work items

## Quick Start

### Prerequisites

- Node.js 20+
- Docker
- Kubernetes cluster (minikube for local dev)
- Anthropic API key

### Local Development

```bash
# Clone and setup
cd platform-v2

# Install dependencies
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

# Set environment variables
export ANTHROPIC_API_KEY=your-api-key

# Start development servers
make dev

# Open http://localhost:3000 in your browser
```

### Kubernetes Deployment

```bash
# Set required environment variables
export ANTHROPIC_API_KEY=your-api-key
export GITHUB_TOKEN=your-github-token

# Build and push images
make build push

# Deploy to Kubernetes
make deploy

# Check status
make status

# Port forward to access locally
make port-forward
```

## Directory Structure

```
platform-v2/
├── .platform/                 # Platform state directory
│   ├── config.yaml           # Platform configuration
│   ├── project.yaml          # Current project metadata
│   ├── backlog/              # Story backlog
│   │   ├── index.yaml        # Prioritized story list
│   │   └── stories/          # Individual story YAML files
│   ├── sprints/              # Sprint data
│   ├── reviews/              # Review results
│   ├── agents/               # Agent registry and heartbeats
│   ├── events/               # Event log (JSONL)
│   ├── generated/            # Auto-generated Markdown docs
│   ├── prompts/              # Agent system prompts
│   ├── skills/               # Reusable agent skills
│   └── schemas/              # JSON Schema validation
├── backend/                   # Node.js backend API
├── frontend/                  # Next.js frontend
├── mcp-servers/              # MCP tool servers
│   ├── agent-launcher/       # K8s agent management
│   ├── progress-reporter/    # WebSocket progress
│   └── azure-devops/         # ADO integration
├── docker/                    # Dockerfiles and scripts
├── k8s/                       # Kubernetes manifests
└── Makefile                   # Build and deploy automation
```

## Configuration

### Platform Configuration (`.platform/config.yaml`)

```yaml
platform:
  version: "2.0"
  cli: "claude-code"              # claude-code | github-copilot | codex
  max_parallel_agents: 4
  kubernetes:
    namespace: "agent-platform"
    resource_limits:
      cpu: "1"
      memory: "2Gi"
  cost_tracking:
    enabled: true
    alert_threshold_usd: 50.0
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude | Yes |
| `GITHUB_TOKEN` | GitHub token for repo access | No |
| `ADO_ORG_URL` | Azure DevOps organization URL | No |
| `ADO_PAT` | Azure DevOps personal access token | No |

## Agent Roles

### PM (Project Manager) Agent
- Orchestrates the entire development lifecycle
- Spawns and monitors other agents
- Manages sprint planning and review cycles

### Scrum Master Agent
- Breaks down user ideas into stories
- Creates acceptance criteria
- Maps dependencies between stories

### Developer Agent(s)
- Implements individual stories
- Works in isolated git worktrees
- Writes tests for acceptance criteria

### Reviewer Agent
- Reviews code from all developer agents
- Runs CI checks and tests
- Merges passing stories, creates fix stories for failures

## API Endpoints

### Project
- `POST /api/project` - Create new project with idea
- `GET /api/project` - Get current project
- `POST /api/project/start` - Start PM agent

### Stories
- `GET /api/stories` - List all stories
- `POST /api/stories` - Create story
- `PATCH /api/stories/:id/status` - Update story status

### Sprints
- `GET /api/sprints` - List all sprints
- `POST /api/sprints` - Create sprint
- `POST /api/sprints/:id/start` - Start sprint

### Agents
- `GET /api/agents/active` - List active agents
- `PUT /api/agents/:id/heartbeat` - Update agent heartbeat

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `make test`
5. Submit a pull request

## License

MIT License - see LICENSE file for details.
