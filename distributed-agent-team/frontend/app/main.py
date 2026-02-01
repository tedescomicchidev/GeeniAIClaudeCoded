"""
Distributed Agent Team Frontend
FastAPI application that orchestrates parallel software development agents.
"""

import asyncio
import os
from typing import Dict, Optional
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, HttpUrl
import uvicorn

from agent_manager import AgentManager, RunStatus
from git_manager import GitManager

# Initialize FastAPI app
app = FastAPI(
    title="Distributed Agent Team",
    description="Orchestrate parallel software development agents",
    version="1.0.0"
)

# Templates
templates = Jinja2Templates(directory="app/templates")

# Global state for tracking runs
runs: Dict[str, RunStatus] = {}
agent_manager: Optional[AgentManager] = None
git_manager: Optional[GitManager] = None


class StartRunRequest(BaseModel):
    """Request model for starting a new run."""
    prompt: str
    agent_count: int = 3
    repo_url: str


class RunResponse(BaseModel):
    """Response model for run status."""
    run_id: str
    status: str
    message: str


@app.on_event("startup")
async def startup_event():
    """Initialize managers on startup."""
    global agent_manager, git_manager

    workspace_path = os.environ.get("WORKSPACE_PATH", "/workspace")
    agent_manager = AgentManager(workspace_path=workspace_path)
    git_manager = GitManager(workspace_path=workspace_path)

    print(f"Initialized with workspace: {workspace_path}")


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """Serve the main UI."""
    return templates.TemplateResponse("index.html", {
        "request": request,
        "runs": runs
    })


@app.post("/api/start", response_model=RunResponse)
async def start_run(request: StartRunRequest, background_tasks: BackgroundTasks):
    """Start a new distributed agent run."""
    if agent_manager is None:
        raise HTTPException(status_code=500, detail="Agent manager not initialized")

    # Validate inputs
    if request.agent_count < 1 or request.agent_count > 10:
        raise HTTPException(
            status_code=400,
            detail="Agent count must be between 1 and 10"
        )

    if not request.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt cannot be empty")

    if not request.repo_url.strip():
        raise HTTPException(status_code=400, detail="Repository URL cannot be empty")

    # Start the run in background
    run_id = await agent_manager.create_run(
        prompt=request.prompt,
        agent_count=request.agent_count,
        repo_url=request.repo_url
    )

    runs[run_id] = RunStatus(
        run_id=run_id,
        status="initializing",
        message="Setting up git worktrees and agent pods..."
    )

    # Execute the run in background
    background_tasks.add_task(execute_run, run_id, request)

    return RunResponse(
        run_id=run_id,
        status="started",
        message=f"Run {run_id} started with {request.agent_count} agents"
    )


async def execute_run(run_id: str, request: StartRunRequest):
    """Execute a run in the background."""
    try:
        runs[run_id].status = "cloning"
        runs[run_id].message = f"Cloning repository: {request.repo_url}"

        # Execute the full workflow
        result = await agent_manager.start_run(
            run_id=run_id,
            prompt=request.prompt,
            agent_count=request.agent_count,
            repo_url=request.repo_url,
            status_callback=lambda status, msg: update_run_status(run_id, status, msg)
        )

        runs[run_id].status = "completed"
        runs[run_id].message = "All agents completed their tasks"
        runs[run_id].results = result

    except Exception as e:
        runs[run_id].status = "failed"
        runs[run_id].message = f"Error: {str(e)}"
        runs[run_id].error = str(e)


def update_run_status(run_id: str, status: str, message: str):
    """Update run status (called from agent_manager)."""
    if run_id in runs:
        runs[run_id].status = status
        runs[run_id].message = message


@app.get("/api/status/{run_id}")
async def get_status(run_id: str):
    """Get status of a specific run."""
    if run_id not in runs:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    return runs[run_id].to_dict()


@app.get("/api/runs")
async def list_runs():
    """List all runs."""
    return {
        "runs": [run.to_dict() for run in runs.values()]
    }


@app.delete("/api/runs/{run_id}")
async def cancel_run(run_id: str):
    """Cancel and cleanup a run."""
    if run_id not in runs:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    if agent_manager is None:
        raise HTTPException(status_code=500, detail="Agent manager not initialized")

    try:
        await agent_manager.cleanup_run(run_id)
        runs[run_id].status = "cancelled"
        runs[run_id].message = "Run cancelled and cleaned up"
        return {"status": "cancelled", "run_id": run_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to cancel run: {str(e)}")


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


@app.get("/ready")
async def readiness_check():
    """Readiness check endpoint."""
    if agent_manager is None:
        return JSONResponse(
            status_code=503,
            content={"status": "not ready", "reason": "Agent manager not initialized"}
        )
    return {"status": "ready"}


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=os.environ.get("DEBUG", "false").lower() == "true"
    )
