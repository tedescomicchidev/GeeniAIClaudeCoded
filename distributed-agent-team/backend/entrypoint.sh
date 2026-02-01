#!/bin/bash
set -euo pipefail

# Force all HTTP traffic through the Squid proxy
export HTTP_PROXY="http://squid-proxy.proxy.svc.cluster.local:3128"
export HTTPS_PROXY="http://squid-proxy.proxy.svc.cluster.local:3128"
export http_proxy="http://squid-proxy.proxy.svc.cluster.local:3128"
export https_proxy="http://squid-proxy.proxy.svc.cluster.local:3128"

# Bypass proxy for internal cluster communication
export NO_PROXY=".agents.svc.cluster.local,.dmz.svc.cluster.local,.proxy.svc.cluster.local,localhost,127.0.0.1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
export no_proxy="${NO_PROXY}"

# Git configuration for proxy
git config --global http.proxy "${HTTP_PROXY}"
git config --global https.proxy "${HTTPS_PROXY}"

# Set git user for commits (agents use generic identity)
git config --global user.email "agent@distributed-team.local"
git config --global user.name "Agent Worker"

# Ensure workspace directory exists and is writable
mkdir -p /workspace

echo "Starting Supergateway with Claude MCP serve..."
echo "Proxy: ${HTTP_PROXY}"
echo "Port: 8080"
echo "Health endpoint: /healthz"

# Start Supergateway bridging claude mcp serve (stdio) → Streamable HTTP on port 8080
# --healthEndpoint /healthz provides a liveness/readiness probe endpoint
exec npx -y supergateway \
    --stdio "claude mcp serve" \
    --outputTransport streamableHttp \
    --port 8080 \
    --healthEndpoint /healthz
