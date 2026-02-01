# Backend Agent Worker Container
# Claude CLI + Supergateway for MCP over HTTP
#
# Based on node:20 with modifications:
# - KEEP: git, procps, sudo, gh, iproute2, dnsutils, jq, npm-global setup, Claude CLI
# - REMOVE: iptables, ipset, aggregate (firewall handled by Calico/Squid), interactive tools
# - ADD: supergateway, Python 3.12+

FROM node:20

ARG TZ=UTC
ENV TZ="$TZ"

ARG CLAUDE_CODE_VERSION=latest

# Install essential packages (no interactive tools, no firewall packages)
RUN apt-get update && apt-get install -y --no-install-recommends \
    less \
    git \
    procps \
    sudo \
    unzip \
    gnupg2 \
    gh \
    iproute2 \
    dnsutils \
    jq \
    curl \
    ca-certificates \
    python3 \
    python3-pip \
    python3-venv \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Create symlinks for python
RUN ln -sf /usr/bin/python3 /usr/bin/python

# Ensure default node user has access to /usr/local/share
RUN mkdir -p /usr/local/share/npm-global && \
    chown -R node:node /usr/local/share

ARG USERNAME=node

# Persist bash history
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
    && mkdir /commandhistory \
    && touch /commandhistory/.bash_history \
    && chown -R $USERNAME /commandhistory

# Set environment variable to indicate container context
ENV DEVCONTAINER=true

# Create workspace and config directories and set permissions
RUN mkdir -p /workspace /home/node/.claude && \
    chown -R node:node /workspace /home/node/.claude

WORKDIR /workspace

# Set up non-root user
USER node

# Set up npm global packages path
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin

# Install Claude CLI
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

# Install Supergateway globally
RUN npm install -g supergateway

# Copy entrypoint script
COPY --chown=node:node entrypoint.sh /home/node/entrypoint.sh
RUN chmod +x /home/node/entrypoint.sh

# Expose MCP HTTP port
EXPOSE 8080

# Health check endpoint
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8080/healthz || exit 1

# Set entrypoint
ENTRYPOINT ["/home/node/entrypoint.sh"]
