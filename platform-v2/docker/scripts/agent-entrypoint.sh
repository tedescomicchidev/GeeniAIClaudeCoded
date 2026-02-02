#!/bin/bash
set -euo pipefail

# Multi-Agent Platform - Agent Entrypoint Script
# This script initializes the agent environment and launches the appropriate CLI

# Environment variables (set by K8s job)
AGENT_ROLE="${AGENT_ROLE:-developer}"
AGENT_ID="${AGENT_ID:-agent-$(hostname)}"
STORY_ID="${STORY_ID:-}"
SPRINT_ID="${SPRINT_ID:-}"
CLI_TOOL="${CLI_TOOL:-claude-code}"
BRANCH_NAME="${BRANCH_NAME:-}"
REPO_PATH="${REPO_PATH:-/workspace/repo}"
PLATFORM_PATH="${PLATFORM_PATH:-/workspace/.platform}"
WORKTREE_BASE="${WORKTREE_BASE:-/workspace/worktrees}"

echo "=========================================="
echo "Multi-Agent Platform - Agent Runner v2"
echo "=========================================="
echo "Agent Role: $AGENT_ROLE"
echo "Agent ID: $AGENT_ID"
echo "Story ID: $STORY_ID"
echo "Sprint ID: $SPRINT_ID"
echo "Branch: $BRANCH_NAME"
echo "CLI Tool: $CLI_TOOL"
echo "=========================================="

# Initialize firewall (requires sudo, configured in Dockerfile)
if [ -x /usr/local/bin/init-firewall.sh ]; then
    echo "Initializing network firewall..."
    sudo /usr/local/bin/init-firewall.sh || echo "Firewall init skipped (non-root)"
fi

# Function to write heartbeat
write_heartbeat() {
    local status="$1"
    local current_task="${2:-}"
    local progress="${3:-0}"

    mkdir -p "$PLATFORM_PATH/agents/heartbeats"

    cat > "$PLATFORM_PATH/agents/heartbeats/${AGENT_ID}.yaml" <<EOF
agent_id: "$AGENT_ID"
role: "$AGENT_ROLE"
story_id: ${STORY_ID:+"\"$STORY_ID\""}${STORY_ID:-null}
sprint_id: ${SPRINT_ID:+"\"$SPRINT_ID\""}${SPRINT_ID:-null}
status: "$status"
current_task: "$current_task"
progress_percent: $progress
started_at: "$START_TIME"
last_heartbeat: "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
EOF
}

# Function to write event to event log
write_event() {
    local event_type="$1"
    local data="$2"

    mkdir -p "$PLATFORM_PATH/events"

    echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"type\":\"$event_type\",\"agent_id\":\"$AGENT_ID\",\"sprint_id\":\"$SPRINT_ID\",\"story_id\":\"$STORY_ID\",\"data\":$data}" >> "$PLATFORM_PATH/events/event-log.jsonl"
}

# Record start time
START_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Write initial heartbeat
write_heartbeat "starting" "Initializing agent environment"
write_event "agent.spawned" "{\"role\":\"$AGENT_ROLE\"}"

# Setup git worktree for developer/reviewer agents
if [[ "$AGENT_ROLE" == "developer" && -n "$BRANCH_NAME" ]]; then
    echo "Setting up git worktree for branch: $BRANCH_NAME"

    cd "$REPO_PATH"

    # Fetch latest from origin
    git fetch origin main || true

    # Create worktree with new branch
    WORKTREE_PATH="$WORKTREE_BASE/$BRANCH_NAME"
    if [ -d "$WORKTREE_PATH" ]; then
        echo "Worktree already exists, using it"
    else
        git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME" origin/main
    fi

    cd "$WORKTREE_PATH"
    echo "Working in: $(pwd)"

    write_heartbeat "running" "Worktree created, starting implementation"
fi

if [[ "$AGENT_ROLE" == "reviewer" ]]; then
    echo "Reviewer agent - working from main repository"
    cd "$REPO_PATH"
    git fetch origin main
    git checkout main
    git pull origin main || true
fi

# Load the appropriate system prompt
PROMPT_FILE="$PLATFORM_PATH/prompts/${AGENT_ROLE}-prompt.md"
if [ ! -f "$PROMPT_FILE" ]; then
    PROMPT_FILE="/workspace/prompts/${AGENT_ROLE}-agent-prompt.md"
fi

if [ ! -f "$PROMPT_FILE" ]; then
    echo "Warning: Prompt file not found: $PROMPT_FILE"
    SYSTEM_PROMPT="You are a $AGENT_ROLE agent. Execute your assigned task for story $STORY_ID."
else
    # Read and process prompt template
    SYSTEM_PROMPT=$(cat "$PROMPT_FILE")

    # Replace template variables
    SYSTEM_PROMPT="${SYSTEM_PROMPT//\{\{STORY_ID\}\}/$STORY_ID}"
    SYSTEM_PROMPT="${SYSTEM_PROMPT//\{\{SPRINT_ID\}\}/$SPRINT_ID}"
    SYSTEM_PROMPT="${SYSTEM_PROMPT//\{\{AGENT_ID\}\}/$AGENT_ID}"
    SYSTEM_PROMPT="${SYSTEM_PROMPT//\{\{BRANCH_NAME\}\}/$BRANCH_NAME}"

    # Load story details if developer
    if [[ "$AGENT_ROLE" == "developer" && -n "$STORY_ID" && -f "$PLATFORM_PATH/backlog/stories/${STORY_ID}.yaml" ]]; then
        STORY_YAML="$PLATFORM_PATH/backlog/stories/${STORY_ID}.yaml"
        STORY_DESCRIPTION=$(grep -A 100 "^description:" "$STORY_YAML" | head -20 | sed 's/^description: *//' | sed 's/^  //')
        ACCEPTANCE_CRITERIA=$(grep -A 100 "^acceptance_criteria:" "$STORY_YAML" | grep "^  -" | sed 's/^  - /\n- /')

        SYSTEM_PROMPT="${SYSTEM_PROMPT//\{\{STORY_DESCRIPTION\}\}/$STORY_DESCRIPTION}"
        SYSTEM_PROMPT="${SYSTEM_PROMPT//\{\{ACCEPTANCE_CRITERIA\}\}/$ACCEPTANCE_CRITERIA}"
    fi
fi

# Build the initial message for the agent
case "$AGENT_ROLE" in
    pm)
        INITIAL_MESSAGE="Begin orchestrating the project. Read the project idea from .platform/project.yaml and start the planning phase by spawning the scrum master agent."
        ;;
    scrum-master)
        INITIAL_MESSAGE="Read the project idea from .platform/project.yaml and break it down into user stories. Write each story to .platform/backlog/stories/ as YAML files."
        ;;
    developer)
        INITIAL_MESSAGE="Execute your assigned task. Story: $STORY_ID. Read the story YAML first, then implement all acceptance criteria on branch $BRANCH_NAME."
        ;;
    reviewer)
        INITIAL_MESSAGE="Review all code produced during sprint $SPRINT_ID. Read the sprint details from .platform/sprints/$SPRINT_ID/ and review each story branch."
        ;;
    *)
        INITIAL_MESSAGE="Execute your assigned task."
        ;;
esac

write_heartbeat "running" "Launching $CLI_TOOL agent"

# Background heartbeat updater
(
    while true; do
        sleep 60
        if [ -f "$PLATFORM_PATH/agents/heartbeats/${AGENT_ID}.yaml" ]; then
            # Update just the timestamp
            sed -i "s/last_heartbeat:.*/last_heartbeat: \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"/" \
                "$PLATFORM_PATH/agents/heartbeats/${AGENT_ID}.yaml" 2>/dev/null || true
        fi
    done
) &
HEARTBEAT_PID=$!

# Cleanup on exit
cleanup() {
    kill $HEARTBEAT_PID 2>/dev/null || true

    # Determine final status
    if [ $EXIT_CODE -eq 0 ]; then
        write_heartbeat "completed" "Agent finished successfully"
        write_event "agent.completed" "{\"exit_code\":0}"
    else
        write_heartbeat "failed" "Agent failed with exit code $EXIT_CODE"
        write_event "agent.failed" "{\"exit_code\":$EXIT_CODE}"
    fi
}

EXIT_CODE=0
trap 'EXIT_CODE=$?; cleanup' EXIT

# Launch the agent using the selected CLI tool
echo "Launching agent with $CLI_TOOL..."

case "$CLI_TOOL" in
    claude-code)
        # Use Claude Code CLI with appropriate permissions
        claude \
            --print \
            --allowedTools "Read,Write,Edit,Bash,Glob,Grep,Task" \
            --permission-mode acceptEdits \
            --max-turns 100 \
            --output-format text \
            "$INITIAL_MESSAGE

System context:
$SYSTEM_PROMPT"
        ;;

    github-copilot)
        # GitHub Copilot CLI (if available)
        if command -v gh-copilot &> /dev/null; then
            echo "$SYSTEM_PROMPT" > /tmp/system-prompt.txt
            gh copilot suggest "$INITIAL_MESSAGE" --context /tmp/system-prompt.txt
        else
            echo "GitHub Copilot CLI not available, falling back to Claude Code"
            claude \
                --print \
                --allowedTools "Read,Write,Edit,Bash,Glob,Grep,Task" \
                --permission-mode acceptEdits \
                --max-turns 100 \
                "$INITIAL_MESSAGE"
        fi
        ;;

    codex)
        # OpenAI Codex (if available)
        if command -v codex &> /dev/null; then
            codex --prompt "$SYSTEM_PROMPT\n\n$INITIAL_MESSAGE"
        else
            echo "Codex CLI not available, falling back to Claude Code"
            claude \
                --print \
                --allowedTools "Read,Write,Edit,Bash,Glob,Grep,Task" \
                --permission-mode acceptEdits \
                --max-turns 100 \
                "$INITIAL_MESSAGE"
        fi
        ;;

    *)
        echo "Unknown CLI tool: $CLI_TOOL"
        exit 1
        ;;
esac

echo "Agent execution completed"
