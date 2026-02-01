"""
Agent Manager - Orchestrates backend agent pods and MCP communication.

Handles:
- Dynamic pod/service creation in Kubernetes
- Git worktree setup
- MCP communication via Claude Agent SDK
- Cleanup of ephemeral resources
"""

import asyncio
import uuid
import os
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional
import httpx
from kubernetes import client, config
from kubernetes.client.rest import ApiException

from git_manager import GitManager

# Import Claude Agent SDK
try:
    from claude_agent_sdk import query, ClaudeAgentOptions, AssistantMessage, ResultMessage, SystemMessage
    CLAUDE_SDK_AVAILABLE = True
except ImportError:
    CLAUDE_SDK_AVAILABLE = False
    print("Warning: claude-agent-sdk not available. Install with: pip install claude-agent-sdk")


@dataclass
class AgentEndpoint:
    """Represents a backend agent endpoint."""
    pod_name: str
    svc_name: str
    url: str
    branch: str
    worktree: str
    status: str = "pending"
    result: Optional[Dict[str, Any]] = None


@dataclass
class RunStatus:
    """Status of a distributed run."""
    run_id: str
    status: str
    message: str
    agents: List[AgentEndpoint] = field(default_factory=list)
    results: Optional[List[Dict[str, Any]]] = None
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "run_id": self.run_id,
            "status": self.status,
            "message": self.message,
            "agents": [
                {
                    "pod_name": a.pod_name,
                    "branch": a.branch,
                    "status": a.status,
                    "result": a.result
                }
                for a in self.agents
            ],
            "results": self.results,
            "error": self.error
        }


class AgentManager:
    """Manages backend agent pods and orchestrates distributed runs."""

    def __init__(self, workspace_path: str = "/workspace"):
        self.workspace_path = workspace_path
        self.git_manager = GitManager(workspace_path)
        self.namespace = os.environ.get("AGENTS_NAMESPACE", "agents")
        self.agent_image = os.environ.get("AGENT_IMAGE", "agent-worker:latest")
        self.api_key_secret = os.environ.get("API_KEY_SECRET", "anthropic-api-key")
        self.pvc_name = os.environ.get("PVC_NAME", "workspace-pvc")

        # Track active runs
        self.active_runs: Dict[str, RunStatus] = {}

        # Initialize Kubernetes client
        try:
            config.load_incluster_config()
        except config.ConfigException:
            config.load_kube_config()

        self.core_v1 = client.CoreV1Api()

    async def create_run(self, prompt: str, agent_count: int, repo_url: str) -> str:
        """Create a new run and return its ID."""
        run_id = uuid.uuid4().hex[:8]
        self.active_runs[run_id] = RunStatus(
            run_id=run_id,
            status="created",
            message="Run created"
        )
        return run_id

    async def start_run(
        self,
        run_id: str,
        prompt: str,
        agent_count: int,
        repo_url: str,
        status_callback: Optional[Callable[[str, str], None]] = None
    ) -> List[Dict[str, Any]]:
        """
        Orchestrate the full run:
        1. Clone repo + create worktrees
        2. Create backend pods + services
        3. Wait for pods ready
        4. Instruct each agent via MCP
        5. Cleanup
        """
        def update_status(status: str, message: str):
            if status_callback:
                status_callback(status, message)
            if run_id in self.active_runs:
                self.active_runs[run_id].status = status
                self.active_runs[run_id].message = message

        try:
            # 1. Clone repo + create worktrees
            update_status("cloning", f"Cloning repository: {repo_url}")
            base_dir = os.path.join(self.workspace_path, "repos", run_id)
            main_dir = os.path.join(base_dir, "main")

            self.git_manager.clone(repo_url, main_dir)

            branches = []
            for i in range(agent_count):
                branch = f"agent-{run_id}-{i}"
                worktree = os.path.join(base_dir, f"worktree-{i}")
                self.git_manager.create_worktree(main_dir, worktree, branch)
                branches.append({"branch": branch, "worktree": worktree})

            # 2. Create backend pods + services
            update_status("creating_pods", f"Creating {agent_count} agent pods...")
            endpoints: List[AgentEndpoint] = []

            for i in range(agent_count):
                pod_name = f"agent-worker-{run_id}-{i}"
                svc_name = f"agent-svc-{run_id}-{i}"

                # Create Pod
                pod_body = self._build_agent_pod(
                    pod_name=pod_name,
                    worktree_path=branches[i]["worktree"],
                    run_id=run_id
                )
                self.core_v1.create_namespaced_pod(
                    namespace=self.namespace,
                    body=pod_body
                )

                # Create Service
                svc_body = self._build_agent_service(
                    svc_name=svc_name,
                    pod_name=pod_name
                )
                self.core_v1.create_namespaced_service(
                    namespace=self.namespace,
                    body=svc_body
                )

                endpoint = AgentEndpoint(
                    pod_name=pod_name,
                    svc_name=svc_name,
                    url=f"http://{svc_name}.{self.namespace}.svc.cluster.local:8080/mcp",
                    branch=branches[i]["branch"],
                    worktree=branches[i]["worktree"]
                )
                endpoints.append(endpoint)

            self.active_runs[run_id].agents = endpoints

            # 3. Wait for all pods ready
            update_status("waiting_pods", "Waiting for agent pods to become ready...")
            await self._wait_for_pods_ready(endpoints, timeout=120)

            # 4. Instruct each agent in parallel via SDK + MCP
            update_status("running", "Agents are working on the task...")

            if not CLAUDE_SDK_AVAILABLE:
                raise RuntimeError("Claude Agent SDK not available")

            tasks = []
            for i, ep in enumerate(endpoints):
                tasks.append(self._instruct_agent(
                    mcp_url=ep.url,
                    server_name=f"agent-{i}",
                    prompt=prompt,
                    worktree=ep.worktree,
                    branch=ep.branch,
                    endpoint=ep
                ))

            results = await asyncio.gather(*tasks, return_exceptions=True)

            # Process results
            final_results = []
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    final_results.append({
                        "branch": endpoints[i].branch,
                        "status": "error",
                        "error": str(result)
                    })
                    endpoints[i].status = "error"
                    endpoints[i].result = {"error": str(result)}
                else:
                    final_results.append(result)
                    endpoints[i].status = "completed"
                    endpoints[i].result = result

            # 5. Cleanup
            update_status("cleaning_up", "Cleaning up agent pods...")
            await self._cleanup_endpoints(endpoints)

            return final_results

        except Exception as e:
            update_status("failed", f"Run failed: {str(e)}")
            # Attempt cleanup on failure
            if run_id in self.active_runs and self.active_runs[run_id].agents:
                try:
                    await self._cleanup_endpoints(self.active_runs[run_id].agents)
                except Exception:
                    pass
            raise

    def _build_agent_pod(
        self,
        pod_name: str,
        worktree_path: str,
        run_id: str
    ) -> client.V1Pod:
        """Build the Pod specification for an agent worker."""
        return client.V1Pod(
            api_version="v1",
            kind="Pod",
            metadata=client.V1ObjectMeta(
                name=pod_name,
                namespace=self.namespace,
                labels={
                    "app": "agent-worker",
                    "run-id": run_id,
                    "pod-id": pod_name
                }
            ),
            spec=client.V1PodSpec(
                service_account_name="default",
                restart_policy="Never",
                containers=[
                    client.V1Container(
                        name="agent",
                        image=self.agent_image,
                        ports=[
                            client.V1ContainerPort(container_port=8080)
                        ],
                        env=[
                            client.V1EnvVar(
                                name="ANTHROPIC_API_KEY",
                                value_from=client.V1EnvVarSource(
                                    secret_key_ref=client.V1SecretKeySelector(
                                        name=self.api_key_secret,
                                        key="api-key"
                                    )
                                )
                            ),
                            client.V1EnvVar(
                                name="WORKTREE_PATH",
                                value=worktree_path
                            ),
                            client.V1EnvVar(
                                name="RUN_ID",
                                value=run_id
                            )
                        ],
                        volume_mounts=[
                            client.V1VolumeMount(
                                name="workspace",
                                mount_path="/workspace"
                            )
                        ],
                        readiness_probe=client.V1Probe(
                            http_get=client.V1HTTPGetAction(
                                path="/healthz",
                                port=8080
                            ),
                            initial_delay_seconds=5,
                            period_seconds=3
                        ),
                        liveness_probe=client.V1Probe(
                            http_get=client.V1HTTPGetAction(
                                path="/healthz",
                                port=8080
                            ),
                            initial_delay_seconds=10,
                            period_seconds=10
                        ),
                        resources=client.V1ResourceRequirements(
                            requests={
                                "cpu": "500m",
                                "memory": "512Mi"
                            },
                            limits={
                                "cpu": "2",
                                "memory": "2Gi"
                            }
                        )
                    )
                ],
                volumes=[
                    client.V1Volume(
                        name="workspace",
                        persistent_volume_claim=client.V1PersistentVolumeClaimVolumeSource(
                            claim_name=self.pvc_name
                        )
                    )
                ]
            )
        )

    def _build_agent_service(
        self,
        svc_name: str,
        pod_name: str
    ) -> client.V1Service:
        """Build the Service specification for an agent worker."""
        return client.V1Service(
            api_version="v1",
            kind="Service",
            metadata=client.V1ObjectMeta(
                name=svc_name,
                namespace=self.namespace
            ),
            spec=client.V1ServiceSpec(
                selector={
                    "pod-id": pod_name
                },
                ports=[
                    client.V1ServicePort(
                        port=8080,
                        target_port=8080
                    )
                ],
                type="ClusterIP"
            )
        )

    async def _wait_for_pods_ready(
        self,
        endpoints: List[AgentEndpoint],
        timeout: int = 120
    ):
        """Wait for all agent pods to be ready (health check passes)."""
        start_time = asyncio.get_event_loop().time()

        while True:
            elapsed = asyncio.get_event_loop().time() - start_time
            if elapsed > timeout:
                raise TimeoutError(f"Pods not ready after {timeout} seconds")

            all_ready = True
            async with httpx.AsyncClient() as client:
                for ep in endpoints:
                    if ep.status == "ready":
                        continue

                    health_url = ep.url.replace("/mcp", "/healthz")
                    try:
                        response = await client.get(health_url, timeout=5.0)
                        if response.status_code == 200:
                            ep.status = "ready"
                        else:
                            all_ready = False
                    except Exception:
                        all_ready = False

            if all_ready:
                return

            await asyncio.sleep(2)

    async def _instruct_agent(
        self,
        mcp_url: str,
        server_name: str,
        prompt: str,
        worktree: str,
        branch: str,
        endpoint: AgentEndpoint
    ) -> Dict[str, Any]:
        """Send the prompt to one backend agent via MCP."""
        agent_prompt = f"""You are a software development agent.

Your working directory is: {worktree}
Your branch is: {branch}

TASK: {prompt}

RULES:
- Work ONLY in {worktree}
- Commit all changes to branch {branch}
- Stage and commit when done. Do NOT push.
- Write clean, production-quality code.
- Follow best practices for the language/framework being used.
- Include appropriate tests if the task involves code changes.
"""

        options = ClaudeAgentOptions(
            mcp_servers={
                server_name: {
                    "type": "http",
                    "url": mcp_url,
                }
            },
            allowed_tools=[f"mcp__{server_name}__*"],
            permission_mode="bypassPermissions",
            max_turns=200,
            model="sonnet",
        )

        result = {
            "branch": branch,
            "worktree": worktree,
            "status": "unknown",
            "messages": [],
            "cost": 0.0
        }

        async for message in query(prompt=agent_prompt, options=options):
            if isinstance(message, SystemMessage) and message.subtype == "init":
                # Check MCP connection status
                failed = [
                    s for s in message.data.get("mcp_servers", [])
                    if s.get("status") != "connected"
                ]
                if failed:
                    raise RuntimeError(f"MCP connection failed: {failed}")

            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if hasattr(block, "text"):
                        result["messages"].append(block.text)

            if isinstance(message, ResultMessage):
                result["status"] = message.subtype
                result["cost"] = message.total_cost_usd

        return result

    async def _cleanup_endpoints(self, endpoints: List[AgentEndpoint]):
        """Delete pods and services for the given endpoints."""
        for ep in endpoints:
            try:
                self.core_v1.delete_namespaced_pod(
                    name=ep.pod_name,
                    namespace=self.namespace,
                    grace_period_seconds=0
                )
            except ApiException as e:
                if e.status != 404:
                    print(f"Error deleting pod {ep.pod_name}: {e}")

            try:
                self.core_v1.delete_namespaced_service(
                    name=ep.svc_name,
                    namespace=self.namespace
                )
            except ApiException as e:
                if e.status != 404:
                    print(f"Error deleting service {ep.svc_name}: {e}")

    async def cleanup_run(self, run_id: str):
        """Cleanup all resources for a run."""
        if run_id in self.active_runs:
            await self._cleanup_endpoints(self.active_runs[run_id].agents)

    async def update_squid_allowlist(self, domains: List[str]):
        """
        Dynamically add domains to the Squid proxy allowlist.
        Patches the ConfigMap and sends SIGHUP to Squid to reload.
        """
        try:
            # Get current ConfigMap
            cm = self.core_v1.read_namespaced_config_map(
                name="squid-config",
                namespace="proxy"
            )

            # Parse current config
            current_config = cm.data.get("squid.conf", "")

            # Add new domains (before the deny all line)
            new_acl_lines = []
            for domain in domains:
                acl_line = f"acl allowed_domains dstdomain {domain}"
                if acl_line not in current_config:
                    new_acl_lines.append(acl_line)

            if new_acl_lines:
                # Insert new ACLs before "http_access deny all"
                lines = current_config.split("\n")
                new_lines = []
                for line in lines:
                    if line.strip() == "http_access deny all":
                        new_lines.extend(new_acl_lines)
                    new_lines.append(line)

                cm.data["squid.conf"] = "\n".join(new_lines)

                # Patch the ConfigMap
                self.core_v1.patch_namespaced_config_map(
                    name="squid-config",
                    namespace="proxy",
                    body=cm
                )

                # Send SIGHUP to Squid to reload config
                await self._reload_squid()

        except ApiException as e:
            print(f"Error updating Squid allowlist: {e}")
            raise

    async def _reload_squid(self):
        """Send SIGHUP to Squid pod to reload configuration."""
        try:
            # Find the squid pod
            pods = self.core_v1.list_namespaced_pod(
                namespace="proxy",
                label_selector="app=squid-proxy"
            )

            if pods.items:
                pod_name = pods.items[0].metadata.name

                # Execute kill -HUP 1 in the pod
                from kubernetes.stream import stream
                exec_command = ["/bin/sh", "-c", "kill -HUP 1"]

                stream(
                    self.core_v1.connect_get_namespaced_pod_exec,
                    pod_name,
                    "proxy",
                    command=exec_command,
                    stderr=True,
                    stdin=False,
                    stdout=True,
                    tty=False
                )

        except Exception as e:
            print(f"Error reloading Squid: {e}")
