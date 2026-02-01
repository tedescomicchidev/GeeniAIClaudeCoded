# Distributed Software Development Agent Team

A Kubernetes-based system for orchestrating parallel Claude agents that build software on separate git branches.

## Architecture

```
Cluster (minikube local / AKS prod)
├── Namespace: dmz           → frontend-app Pod (Python/FastAPI + Claude Agent SDK)
├── Namespace: agents        → agent-worker-{uuid}-{i} Pods (Claude CLI + Supergateway)
├── Namespace: proxy         → squid-proxy Pod
└── Calico NetworkPolicies   → 6 policies controlling egress
```

### Data Flow

1. User → frontend (dmz:8000) via browser
2. Frontend creates agent pods dynamically in `agents` namespace
3. Frontend → agent pods (agents:8080) via ClusterIP Services
4. Agent pods → squid-proxy (proxy:3128) → allowed URLs only
5. Agent pods → frontend (dmz:8000) for callbacks
6. Internet ✗→ agent pods (blocked — only frontend can reach them)

### Transport Bridge

- Claude CLI's `claude mcp serve` only exposes stdio
- Supergateway wraps it as Streamable HTTP on port 8080
- The Python SDK connects with `"type": "http"` transport to `http://<pod-service>:8080/mcp`

## Prerequisites

- Docker
- Kubernetes cluster (minikube for local, AKS/EKS/GKE for production)
- kubectl configured
- Anthropic API key

### For Local Development

```bash
# Install minikube
brew install minikube  # macOS
# or
curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
sudo install minikube-linux-amd64 /usr/local/bin/minikube
```

## Quick Start

### 1. Set your API key

```bash
export ANTHROPIC_API_KEY="sk-ant-xxx"
```

### 2. Local Development (minikube)

```bash
# Full setup with minikube
make dev

# In a separate terminal, create tunnel for LoadBalancer
minikube tunnel
```

Then access: http://localhost:8000

### 3. Production Deployment

```bash
# Build images
make build

# Push to your registry
REGISTRY=your-registry.azurecr.io make push

# Deploy
REGISTRY=your-registry.azurecr.io make deploy
```

## Usage

1. Open the web UI (http://localhost:8000)
2. Enter your task description in the prompt textarea
3. Provide a git repository URL
4. Set the number of parallel agents (1-10)
5. Click "Go"

Each agent will:
- Work in its own git worktree
- Create a unique branch (e.g., `agent-abc123-0`)
- Implement the task independently
- Commit changes (but not push)

After completion, you can review and merge the branches that produced the best results.

## Project Structure

```
distributed-agent-team/
├── README.md
├── Makefile                               # Build/deploy automation
├── k8s/
│   ├── namespaces.yaml                    # dmz, agents, proxy
│   ├── calico-network-policies.yaml       # 6 NetworkPolicies
│   ├── squid/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   └── configmap.yaml                 # Squid ACL allowlist
│   ├── frontend/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   └── serviceaccount.yaml            # RBAC for pod management
│   ├── secrets/
│   │   └── anthropic-secret.yaml
│   └── storage/
│       └── workspace-pvc.yaml             # Shared PVC (RWX)
├── backend/
│   ├── Dockerfile
│   └── entrypoint.sh
└── frontend/
    ├── Dockerfile
    ├── requirements.txt
    └── app/
        ├── main.py
        ├── agent_manager.py
        ├── git_manager.py
        └── templates/
            └── index.html
```

## Network Security

### Calico NetworkPolicies

| Policy | Description |
|--------|-------------|
| default-deny-egress-agents | Block all outbound from agents |
| allow-agents-to-proxy | Allow agents → Squid (TCP 3128) |
| allow-agents-to-frontend | Allow agents → frontend (TCP 8000) |
| allow-agents-dns | Allow agents → kube-dns (UDP/TCP 53) |
| default-deny-ingress-agents | Block all inbound to agents |
| allow-frontend-to-agents | Allow frontend → agents (TCP 8080) |

### Squid Proxy Allowlist

Default allowed domains:
- `*.github.com`
- `*.githubusercontent.com`
- `registry.npmjs.org`
- `api.anthropic.com`
- `*.sentry.io`
- `*.statsig.com`
- `*.pypi.org`
- `files.pythonhosted.org`

## Configuration

### Environment Variables (Frontend)

| Variable | Default | Description |
|----------|---------|-------------|
| WORKSPACE_PATH | /workspace | Shared workspace mount path |
| AGENTS_NAMESPACE | agents | Namespace for agent pods |
| AGENT_IMAGE | agent-worker:latest | Docker image for agents |
| API_KEY_SECRET | anthropic-api-key | K8s secret name |
| PVC_NAME | workspace-pvc | PVC name for shared storage |

### Shared Storage

Both frontend and agent pods mount the same PVC at `/workspace`. This enables:
- Frontend creates git worktrees
- Agents access their assigned worktree

For RWX (ReadWriteMany) support:
- **minikube**: hostPath or NFS provisioner
- **AKS**: Azure Files
- **EKS**: EFS
- **GKE**: Filestore

## Make Targets

```bash
make help           # Show available targets
make dev            # Full local setup with minikube
make build          # Build Docker images
make push           # Push images to registry
make deploy         # Deploy to Kubernetes
make clean          # Clean up all resources
make logs           # View frontend logs
make status         # Show deployment status
make verify         # Verify deployment health
make test-network   # Test network policies
```

## Verification Checklist

After deployment, verify:

- [ ] 6+ NetworkPolicies exist in agents namespace
- [ ] Backend pods CANNOT reach example.com directly
- [ ] Backend pods CAN reach api.github.com (via proxy)
- [ ] Backend pods CAN reach frontend on port 8000
- [ ] Frontend CAN reach backend pods on port 8080
- [ ] `/healthz` on backend pods returns 200
- [ ] ANTHROPIC_API_KEY loaded from K8s Secret
- [ ] Git worktrees created with unique branch names
- [ ] Agent pods cleaned up after task completion

Run verification:
```bash
make verify
make test-network
```

## Troubleshooting

### Pods not starting

```bash
# Check pod status
kubectl get pods -n agents
kubectl describe pod <pod-name> -n agents

# Check events
kubectl get events -n agents --sort-by='.lastTimestamp'
```

### Network issues

```bash
# Test proxy connectivity from an agent pod
kubectl exec -it <agent-pod> -n agents -- \
  curl -x http://squid-proxy.proxy.svc.cluster.local:3128 https://api.github.com

# Check squid logs
kubectl logs -l app=squid-proxy -n proxy
```

### Storage issues

```bash
# Check PVC status
kubectl get pvc -A

# Check PV
kubectl get pv
```

### Image pull errors

```bash
# For minikube, ensure images are built in minikube's Docker
eval $(minikube docker-env)
make build
```

## Production Considerations

1. **Storage**: Use cloud-native RWX storage (Azure Files, EFS, Filestore)
2. **Image Registry**: Push to a private registry (ACR, ECR, GCR)
3. **TLS**: Add ingress with TLS termination
4. **Monitoring**: Add Prometheus/Grafana for observability
5. **Autoscaling**: Consider HPA for frontend
6. **Secrets**: Use external secrets management (Azure Key Vault, AWS Secrets Manager)

## License

MIT
