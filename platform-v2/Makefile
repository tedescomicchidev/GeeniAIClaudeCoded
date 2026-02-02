# Multi-Agent Developer Platform V2 - Makefile
# Build, deploy, and manage the platform

.PHONY: all build push deploy clean dev test help

# Configuration
REGISTRY ?= ghcr.io/platform
VERSION ?= v2
NAMESPACE ?= agent-platform

# Images
BACKEND_IMAGE = $(REGISTRY)/backend:$(VERSION)
AGENT_IMAGE = $(REGISTRY)/agent-runner:$(VERSION)
FRONTEND_IMAGE = $(REGISTRY)/frontend:$(VERSION)

# Kubernetes context
KUBECTL ?= kubectl
K8S_CONTEXT ?= $(shell kubectl config current-context)

###################
# Development
###################

## Start local development environment
dev: dev-backend dev-frontend
	@echo "Development servers started"

dev-backend:
	@echo "Starting backend..."
	cd backend && npm install && npm run dev &

dev-frontend:
	@echo "Starting frontend..."
	cd frontend && npm install && npm run dev &

## Run tests
test: test-backend test-mcp
	@echo "All tests passed"

test-backend:
	cd backend && npm test

test-mcp:
	cd mcp-servers/agent-launcher && npm test
	cd mcp-servers/progress-reporter && npm test

###################
# Build
###################

## Build all container images
build: build-backend build-agent build-frontend
	@echo "All images built"

build-backend:
	@echo "Building backend image..."
	docker build -t $(BACKEND_IMAGE) -f docker/Dockerfile.backend backend/

build-agent:
	@echo "Building agent runner image..."
	docker build -t $(AGENT_IMAGE) -f docker/Dockerfile.agent .

build-frontend:
	@echo "Building frontend image..."
	docker build -t $(FRONTEND_IMAGE) -f docker/Dockerfile.frontend frontend/

## Push images to registry
push:
	docker push $(BACKEND_IMAGE)
	docker push $(AGENT_IMAGE)
	docker push $(FRONTEND_IMAGE)

###################
# Kubernetes Deployment
###################

## Deploy to Kubernetes
deploy: deploy-namespaces deploy-storage deploy-secrets deploy-proxy deploy-backend
	@echo "Platform deployed to Kubernetes"

deploy-namespaces:
	$(KUBECTL) apply -f k8s/base/namespace.yaml
	$(KUBECTL) apply -f k8s/base/network-policies.yaml

deploy-storage:
	$(KUBECTL) apply -f k8s/storage/platform-pvc.yaml

deploy-secrets:
	@if [ -z "$$ANTHROPIC_API_KEY" ]; then \
		echo "Error: ANTHROPIC_API_KEY not set"; \
		exit 1; \
	fi
	envsubst < k8s/secrets/agent-secrets.yaml | $(KUBECTL) apply -f -

deploy-proxy:
	$(KUBECTL) apply -f k8s/agents/squid-proxy.yaml

deploy-backend:
	$(KUBECTL) apply -f k8s/frontend/backend-deployment.yaml

deploy-prompts:
	@echo "Deploying agent prompts as ConfigMap..."
	$(KUBECTL) create configmap agent-prompts \
		--from-file=.platform/prompts/ \
		-n $(NAMESPACE) \
		--dry-run=client -o yaml | $(KUBECTL) apply -f -

## Undeploy from Kubernetes
undeploy:
	$(KUBECTL) delete namespace $(NAMESPACE) --ignore-not-found
	$(KUBECTL) delete namespace $(NAMESPACE)-dmz --ignore-not-found
	$(KUBECTL) delete namespace $(NAMESPACE)-proxy --ignore-not-found

###################
# Operations
###################

## Show deployment status
status:
	@echo "=== Namespaces ==="
	$(KUBECTL) get ns | grep agent-platform
	@echo "\n=== Pods ==="
	$(KUBECTL) get pods -n $(NAMESPACE) -o wide
	$(KUBECTL) get pods -n $(NAMESPACE)-dmz -o wide
	@echo "\n=== Services ==="
	$(KUBECTL) get svc -n $(NAMESPACE)-dmz
	@echo "\n=== Jobs ==="
	$(KUBECTL) get jobs -n $(NAMESPACE)

## View logs
logs-backend:
	$(KUBECTL) logs -f -l app=platform-backend -n $(NAMESPACE)-dmz

logs-agents:
	$(KUBECTL) logs -f -l platform.type=agent -n $(NAMESPACE) --all-containers

## Port forward backend
port-forward:
	@echo "Backend: http://localhost:3000"
	@echo "WebSocket: ws://localhost:3001"
	$(KUBECTL) port-forward -n $(NAMESPACE)-dmz svc/platform-backend 3000:3000 3001:3001

## Clean up agent jobs
clean-jobs:
	$(KUBECTL) delete jobs -n $(NAMESPACE) -l platform.type=agent

## Clean up everything
clean: undeploy
	@echo "Cleaned up Kubernetes resources"

###################
# Local Testing
###################

## Initialize .platform directory
init-platform:
	@mkdir -p .platform/{backlog/stories,sprints,reviews,agents/heartbeats,events,generated,skills,contracts,prompts,schemas}
	@cp platform-v2/.platform/config.yaml .platform/ 2>/dev/null || true
	@cp platform-v2/.platform/prompts/*.md .platform/prompts/ 2>/dev/null || true
	@cp platform-v2/.platform/skills/*.md .platform/skills/ 2>/dev/null || true
	@cp platform-v2/.platform/schemas/*.json .platform/schemas/ 2>/dev/null || true
	@echo "Platform directory initialized"

## Run with Docker Compose (for local testing)
compose-up:
	docker-compose up -d

compose-down:
	docker-compose down

###################
# Help
###################

## Show help
help:
	@echo "Multi-Agent Developer Platform V2"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Development:"
	@echo "  dev           Start local development servers"
	@echo "  test          Run all tests"
	@echo ""
	@echo "Build:"
	@echo "  build         Build all container images"
	@echo "  push          Push images to registry"
	@echo ""
	@echo "Deployment:"
	@echo "  deploy        Deploy to Kubernetes"
	@echo "  undeploy      Remove from Kubernetes"
	@echo "  status        Show deployment status"
	@echo ""
	@echo "Operations:"
	@echo "  logs-backend  View backend logs"
	@echo "  logs-agents   View agent logs"
	@echo "  port-forward  Forward backend ports locally"
	@echo "  clean-jobs    Clean up completed agent jobs"
	@echo "  clean         Remove all resources"
	@echo ""
	@echo "Configuration:"
	@echo "  REGISTRY      Container registry (default: ghcr.io/platform)"
	@echo "  VERSION       Image version tag (default: v2)"
	@echo "  NAMESPACE     Kubernetes namespace (default: agent-platform)"
