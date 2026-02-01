# Distributed Agent Team - Build and Deploy Automation
#
# Usage:
#   make dev          - Full local development setup with minikube
#   make build        - Build Docker images
#   make push         - Push images to registry
#   make deploy       - Deploy to Kubernetes
#   make clean        - Clean up all resources
#   make logs         - View frontend logs
#   make status       - Show deployment status

# Configuration
REGISTRY ?= localhost:5000
FRONTEND_IMAGE ?= $(REGISTRY)/frontend
BACKEND_IMAGE ?= $(REGISTRY)/agent-worker
VERSION ?= latest

# Kubernetes namespace
NAMESPACE_DMZ = dmz
NAMESPACE_AGENTS = agents
NAMESPACE_PROXY = proxy

.PHONY: all build push deploy clean dev logs status help

# Default target
all: help

help:
	@echo "Distributed Agent Team - Build and Deploy"
	@echo ""
	@echo "Usage:"
	@echo "  make dev           - Full local development setup with minikube"
	@echo "  make build         - Build Docker images"
	@echo "  make push          - Push images to registry"
	@echo "  make deploy        - Deploy to Kubernetes"
	@echo "  make clean         - Clean up all resources"
	@echo "  make logs          - View frontend logs"
	@echo "  make status        - Show deployment status"
	@echo ""
	@echo "Configuration:"
	@echo "  REGISTRY=$(REGISTRY)"
	@echo "  VERSION=$(VERSION)"
	@echo ""
	@echo "Before deploying, set your Anthropic API key:"
	@echo "  export ANTHROPIC_API_KEY=sk-ant-xxx"

# Build Docker images
build: build-frontend build-backend

build-frontend:
	@echo "Building frontend image..."
	docker build -t $(FRONTEND_IMAGE):$(VERSION) -f frontend/Dockerfile frontend/

build-backend:
	@echo "Building backend image..."
	docker build -t $(BACKEND_IMAGE):$(VERSION) -f backend/Dockerfile backend/

# Push images to registry
push: push-frontend push-backend

push-frontend:
	@echo "Pushing frontend image..."
	docker push $(FRONTEND_IMAGE):$(VERSION)

push-backend:
	@echo "Pushing backend image..."
	docker push $(BACKEND_IMAGE):$(VERSION)

# Deploy to Kubernetes
deploy: deploy-namespaces deploy-storage deploy-secrets deploy-proxy deploy-network-policies deploy-frontend

deploy-namespaces:
	@echo "Creating namespaces..."
	kubectl apply -f k8s/namespaces.yaml

deploy-storage:
	@echo "Creating storage..."
	kubectl apply -f k8s/storage/workspace-pvc.yaml

deploy-secrets:
	@echo "Creating secrets..."
	@if [ -z "$(ANTHROPIC_API_KEY)" ]; then \
		echo "WARNING: ANTHROPIC_API_KEY not set. Using placeholder."; \
		kubectl apply -f k8s/secrets/anthropic-secret.yaml; \
	else \
		echo "Creating secret with provided API key..."; \
		kubectl create secret generic anthropic-api-key \
			--from-literal=api-key=$(ANTHROPIC_API_KEY) \
			-n $(NAMESPACE_AGENTS) --dry-run=client -o yaml | kubectl apply -f -; \
		kubectl create secret generic anthropic-api-key \
			--from-literal=api-key=$(ANTHROPIC_API_KEY) \
			-n $(NAMESPACE_DMZ) --dry-run=client -o yaml | kubectl apply -f -; \
	fi

deploy-proxy:
	@echo "Deploying Squid proxy..."
	kubectl apply -f k8s/squid/configmap.yaml
	kubectl apply -f k8s/squid/deployment.yaml
	kubectl apply -f k8s/squid/service.yaml

deploy-network-policies:
	@echo "Applying network policies..."
	kubectl apply -f k8s/calico-network-policies.yaml

deploy-frontend:
	@echo "Deploying frontend..."
	kubectl apply -f k8s/frontend/serviceaccount.yaml
	kubectl apply -f k8s/frontend/deployment.yaml
	kubectl apply -f k8s/frontend/service.yaml

# Local development with minikube
dev: dev-start dev-registry dev-build dev-load deploy dev-tunnel

dev-start:
	@echo "Starting minikube..."
	minikube status || minikube start --driver=docker --cpus=4 --memory=8192
	@echo "Enabling addons..."
	minikube addons enable storage-provisioner
	minikube addons enable default-storageclass

dev-registry:
	@echo "Enabling minikube registry..."
	minikube addons enable registry

dev-build:
	@echo "Building images for minikube..."
	eval $$(minikube docker-env) && \
		docker build -t frontend:latest -f frontend/Dockerfile frontend/ && \
		docker build -t agent-worker:latest -f backend/Dockerfile backend/

dev-load:
	@echo "Images built in minikube Docker daemon"

dev-tunnel:
	@echo ""
	@echo "============================================"
	@echo "Development setup complete!"
	@echo ""
	@echo "To access the frontend, run in a separate terminal:"
	@echo "  minikube tunnel"
	@echo ""
	@echo "Then access: http://localhost:8000"
	@echo ""
	@echo "Or use NodePort:"
	@echo "  minikube service frontend -n dmz"
	@echo "============================================"

# View logs
logs:
	kubectl logs -f -l app=frontend -n $(NAMESPACE_DMZ)

logs-proxy:
	kubectl logs -f -l app=squid-proxy -n $(NAMESPACE_PROXY)

logs-agents:
	kubectl logs -f -l app=agent-worker -n $(NAMESPACE_AGENTS)

# Show status
status:
	@echo "=== Namespaces ==="
	kubectl get namespaces | grep -E "^(dmz|agents|proxy|NAME)"
	@echo ""
	@echo "=== Pods ==="
	kubectl get pods -A | grep -E "^(dmz|agents|proxy|NAMESPACE)"
	@echo ""
	@echo "=== Services ==="
	kubectl get services -A | grep -E "^(dmz|agents|proxy|NAMESPACE)"
	@echo ""
	@echo "=== Network Policies ==="
	kubectl get networkpolicies -n $(NAMESPACE_AGENTS)

# Clean up all resources
clean: clean-frontend clean-agents clean-proxy clean-storage clean-namespaces

clean-frontend:
	@echo "Cleaning frontend..."
	-kubectl delete -f k8s/frontend/service.yaml 2>/dev/null || true
	-kubectl delete -f k8s/frontend/deployment.yaml 2>/dev/null || true
	-kubectl delete -f k8s/frontend/serviceaccount.yaml 2>/dev/null || true

clean-agents:
	@echo "Cleaning agent pods..."
	-kubectl delete pods -l app=agent-worker -n $(NAMESPACE_AGENTS) 2>/dev/null || true
	-kubectl delete services -l app=agent-worker -n $(NAMESPACE_AGENTS) 2>/dev/null || true

clean-proxy:
	@echo "Cleaning proxy..."
	-kubectl delete -f k8s/squid/service.yaml 2>/dev/null || true
	-kubectl delete -f k8s/squid/deployment.yaml 2>/dev/null || true
	-kubectl delete -f k8s/squid/configmap.yaml 2>/dev/null || true

clean-storage:
	@echo "Cleaning storage..."
	-kubectl delete -f k8s/storage/workspace-pvc.yaml 2>/dev/null || true

clean-namespaces:
	@echo "Cleaning namespaces..."
	-kubectl delete -f k8s/namespaces.yaml 2>/dev/null || true

clean-network-policies:
	@echo "Cleaning network policies..."
	-kubectl delete -f k8s/calico-network-policies.yaml 2>/dev/null || true

# Test network policies
test-network:
	@echo "Testing network policies..."
	@echo ""
	@echo "1. Creating test pod in agents namespace..."
	kubectl run test-agent --image=curlimages/curl --rm -it --restart=Never -n $(NAMESPACE_AGENTS) -- \
		sh -c "echo 'Testing blocked: example.com' && curl -s --connect-timeout 5 http://example.com && echo 'FAIL: Should be blocked' || echo 'OK: Blocked as expected'"
	@echo ""
	@echo "2. Test via proxy should work..."
	kubectl run test-proxy --image=curlimages/curl --rm -it --restart=Never -n $(NAMESPACE_AGENTS) -- \
		sh -c "export HTTP_PROXY=http://squid-proxy.proxy.svc.cluster.local:3128 && curl -s --connect-timeout 10 https://api.github.com && echo 'OK: Proxy working'"

# Verify deployment
verify:
	@echo "=== Verifying Deployment ==="
	@echo ""
	@echo "1. Checking namespaces..."
	@kubectl get ns dmz agents proxy >/dev/null 2>&1 && echo "   OK: Namespaces exist" || echo "   FAIL: Namespaces missing"
	@echo ""
	@echo "2. Checking secrets..."
	@kubectl get secret anthropic-api-key -n agents >/dev/null 2>&1 && echo "   OK: Secret exists in agents" || echo "   FAIL: Secret missing in agents"
	@kubectl get secret anthropic-api-key -n dmz >/dev/null 2>&1 && echo "   OK: Secret exists in dmz" || echo "   FAIL: Secret missing in dmz"
	@echo ""
	@echo "3. Checking Squid proxy..."
	@kubectl get pod -l app=squid-proxy -n proxy -o jsonpath='{.items[0].status.phase}' 2>/dev/null | grep -q Running && echo "   OK: Squid running" || echo "   FAIL: Squid not running"
	@echo ""
	@echo "4. Checking frontend..."
	@kubectl get pod -l app=frontend -n dmz -o jsonpath='{.items[0].status.phase}' 2>/dev/null | grep -q Running && echo "   OK: Frontend running" || echo "   FAIL: Frontend not running"
	@echo ""
	@echo "5. Checking network policies..."
	@kubectl get networkpolicy -n agents | wc -l | xargs -I {} sh -c '[ {} -ge 6 ] && echo "   OK: Network policies applied" || echo "   FAIL: Network policies missing"'
	@echo ""
	@echo "6. Checking PVC..."
	@kubectl get pvc workspace-pvc -n dmz >/dev/null 2>&1 && echo "   OK: PVC exists in dmz" || echo "   FAIL: PVC missing in dmz"
	@kubectl get pvc workspace-pvc -n agents >/dev/null 2>&1 && echo "   OK: PVC exists in agents" || echo "   FAIL: PVC missing in agents"
