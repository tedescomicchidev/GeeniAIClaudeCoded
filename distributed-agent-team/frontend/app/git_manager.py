"""
Git Manager - Handles repository cloning and worktree management.

Provides isolation for parallel agents by creating separate git worktrees,
each on its own branch.
"""

import os
import subprocess
from typing import List, Optional


class GitManager:
    """Manages git repositories and worktrees for distributed agents."""

    def __init__(self, workspace_path: str = "/workspace"):
        self.workspace_path = workspace_path

    def clone(self, repo_url: str, dest: str) -> None:
        """
        Clone a git repository.

        Args:
            repo_url: URL of the repository to clone
            dest: Destination directory path
        """
        # Ensure parent directory exists
        parent_dir = os.path.dirname(dest)
        os.makedirs(parent_dir, exist_ok=True)

        # Clone the repository
        result = subprocess.run(
            ["git", "clone", repo_url, dest],
            capture_output=True,
            text=True,
            check=False
        )

        if result.returncode != 0:
            raise RuntimeError(
                f"Failed to clone repository: {result.stderr}"
            )

    def create_worktree(
        self,
        repo_dir: str,
        worktree_path: str,
        branch_name: str
    ) -> None:
        """
        Create a new git worktree with a new branch.

        Args:
            repo_dir: Path to the main repository
            worktree_path: Path where the worktree should be created
            branch_name: Name for the new branch
        """
        # Ensure worktree parent directory exists
        parent_dir = os.path.dirname(worktree_path)
        os.makedirs(parent_dir, exist_ok=True)

        # Create worktree with a new branch
        result = subprocess.run(
            [
                "git", "-C", repo_dir,
                "worktree", "add",
                "-b", branch_name,
                worktree_path
            ],
            capture_output=True,
            text=True,
            check=False
        )

        if result.returncode != 0:
            raise RuntimeError(
                f"Failed to create worktree: {result.stderr}"
            )

    def remove_worktree(self, repo_dir: str, worktree_path: str) -> None:
        """
        Remove a git worktree.

        Args:
            repo_dir: Path to the main repository
            worktree_path: Path of the worktree to remove
        """
        result = subprocess.run(
            [
                "git", "-C", repo_dir,
                "worktree", "remove",
                "--force",
                worktree_path
            ],
            capture_output=True,
            text=True,
            check=False
        )

        if result.returncode != 0:
            # Log but don't fail - worktree might already be gone
            print(f"Warning: Failed to remove worktree: {result.stderr}")

    def list_worktrees(self, repo_dir: str) -> List[str]:
        """
        List all worktrees for a repository.

        Args:
            repo_dir: Path to the main repository

        Returns:
            List of worktree paths
        """
        result = subprocess.run(
            ["git", "-C", repo_dir, "worktree", "list", "--porcelain"],
            capture_output=True,
            text=True,
            check=False
        )

        if result.returncode != 0:
            return []

        worktrees = []
        for line in result.stdout.strip().split("\n"):
            if line.startswith("worktree "):
                worktrees.append(line.replace("worktree ", ""))

        return worktrees

    def get_current_branch(self, repo_dir: str) -> Optional[str]:
        """
        Get the current branch name.

        Args:
            repo_dir: Path to the repository

        Returns:
            Branch name or None if not on a branch
        """
        result = subprocess.run(
            ["git", "-C", repo_dir, "branch", "--show-current"],
            capture_output=True,
            text=True,
            check=False
        )

        if result.returncode != 0:
            return None

        return result.stdout.strip() or None

    def get_branches(self, repo_dir: str) -> List[str]:
        """
        List all branches in a repository.

        Args:
            repo_dir: Path to the repository

        Returns:
            List of branch names
        """
        result = subprocess.run(
            ["git", "-C", repo_dir, "branch", "-a"],
            capture_output=True,
            text=True,
            check=False
        )

        if result.returncode != 0:
            return []

        branches = []
        for line in result.stdout.strip().split("\n"):
            # Remove leading characters (* or spaces)
            branch = line.strip().lstrip("* ")
            if branch:
                branches.append(branch)

        return branches

    def commit_changes(
        self,
        repo_dir: str,
        message: str,
        add_all: bool = True
    ) -> bool:
        """
        Stage and commit changes.

        Args:
            repo_dir: Path to the repository
            message: Commit message
            add_all: Whether to stage all changes

        Returns:
            True if commit was made, False if nothing to commit
        """
        if add_all:
            # Stage all changes
            subprocess.run(
                ["git", "-C", repo_dir, "add", "-A"],
                capture_output=True,
                check=False
            )

        # Check if there are staged changes
        status = subprocess.run(
            ["git", "-C", repo_dir, "status", "--porcelain"],
            capture_output=True,
            text=True,
            check=False
        )

        if not status.stdout.strip():
            return False  # Nothing to commit

        # Commit
        result = subprocess.run(
            ["git", "-C", repo_dir, "commit", "-m", message],
            capture_output=True,
            text=True,
            check=False
        )

        return result.returncode == 0

    def get_commit_log(
        self,
        repo_dir: str,
        count: int = 10,
        branch: Optional[str] = None
    ) -> List[dict]:
        """
        Get recent commit log.

        Args:
            repo_dir: Path to the repository
            count: Number of commits to return
            branch: Branch to get log from (default: current branch)

        Returns:
            List of commit dictionaries with hash, author, date, message
        """
        cmd = [
            "git", "-C", repo_dir, "log",
            f"-{count}",
            "--pretty=format:%H|%an|%ad|%s",
            "--date=short"
        ]

        if branch:
            cmd.append(branch)

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False
        )

        if result.returncode != 0:
            return []

        commits = []
        for line in result.stdout.strip().split("\n"):
            if line:
                parts = line.split("|", 3)
                if len(parts) == 4:
                    commits.append({
                        "hash": parts[0],
                        "author": parts[1],
                        "date": parts[2],
                        "message": parts[3]
                    })

        return commits

    def cleanup_repo(self, repo_dir: str) -> None:
        """
        Clean up a repository directory and all its worktrees.

        Args:
            repo_dir: Path to the main repository
        """
        import shutil

        # First remove all worktrees
        worktrees = self.list_worktrees(repo_dir)
        for wt in worktrees:
            if wt != repo_dir:  # Don't remove the main worktree
                self.remove_worktree(repo_dir, wt)

        # Then remove the entire directory tree
        parent_dir = os.path.dirname(repo_dir)
        if os.path.exists(parent_dir):
            shutil.rmtree(parent_dir, ignore_errors=True)
