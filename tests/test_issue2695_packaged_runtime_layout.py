from __future__ import annotations

import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

# The wheel must ship the built React frontend (frontend/dist/) so an installed
# release serves the real app, not the legacy-static fallback or the 503 shell
# placeholder. Building the frontend requires pnpm + node; environments without
# them skip cleanly (CI provides both via actions/setup-node + pnpm).
_PNPM = shutil.which("pnpm")


def _copy_repo_without_heavy_dirs(dst: Path) -> Path:
    repo_copy = dst / "repo"
    shutil.copytree(
        ROOT,
        repo_copy,
        ignore=shutil.ignore_patterns(
            ".git",
            ".venv",
            "node_modules",
            ".pytest_cache",
            ".ruff_cache",
            "__pycache__",
            "frontend/dist",
        ),
    )
    return repo_copy


def _build_frontend(repo_copy: Path) -> None:
    """Build the React app into repo_copy/frontend/dist (the release workflow)."""
    frontend = repo_copy / "frontend"
    subprocess.run(
        [_PNPM, "install", "--frozen-lockfile"],
        cwd=frontend,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    subprocess.run(
        [_PNPM, "build"],
        cwd=frontend,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _build_wheel(repo_copy: Path) -> Path:
    dist_dir = repo_copy / "dist"
    env = os.environ.copy()
    env["SETUPTOOLS_SCM_PRETEND_VERSION_FOR_HERMES_WEBUI"] = "0.52.2695"
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "wheel",
            ".",
            "--no-deps",
            "--wheel-dir",
            str(dist_dir),
        ],
        cwd=repo_copy,
        env=env,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    wheels = sorted(dist_dir.glob("hermes_webui-*.whl"))
    assert wheels, "wheel build must produce a hermes_webui wheel"
    return wheels[0]


@pytest.fixture(scope="module")
def extracted_wheel(tmp_path_factory):
    if not _PNPM:
        pytest.skip("pnpm not available — cannot build the React frontend for the wheel")
    tmp = tmp_path_factory.mktemp("packaged-runtime")
    repo_copy = _copy_repo_without_heavy_dirs(tmp)
    _build_frontend(repo_copy)
    wheel = _build_wheel(repo_copy)
    extract_dir = tmp / "wheel"
    with zipfile.ZipFile(wheel) as zf:
        zf.extractall(extract_dir)
    return wheel, extract_dir


def test_wheel_build_contains_runtime_tree(extracted_wheel):
    wheel, _ = extracted_wheel
    with zipfile.ZipFile(wheel) as zf:
        names = set(zf.namelist())
        assert "bootstrap.py" in names
        assert "server.py" in names
        assert "mcp_server.py" in names
        assert "api/config.py" in names
        assert "api/_scm_version.py" in names


def test_wheel_contains_react_frontend(extracted_wheel):
    """The wheel must ship the built React app, not the deleted legacy static tree."""
    wheel, _ = extracted_wheel
    with zipfile.ZipFile(wheel) as zf:
        names = set(zf.namelist())
        # The legacy static frontend is gone; the React build must be present.
        assert "static/index.html" not in names
        assert "frontend/dist/index.html" in names
        assert "frontend/dist/manifest.json" in names
        assert "frontend/dist/sw.js" in names
        # At least one hashed JS asset and one CSS asset must be bundled.
        assets = [n for n in names if n.startswith("frontend/dist/assets/")]
        assert any(n.endswith(".js") for n in assets), "wheel must bundle JS assets"
        assert any(n.endswith(".css") for n in assets), "wheel must bundle CSS assets"
        # PWA icons must be present.
        assert "frontend/dist/favicon.ico" in names
        assert "frontend/dist/apple-touch-icon.png" in names


def test_installed_layout_serves_react_index(extracted_wheel):
    """The extracted wheel must resolve the React index via the runtime path logic.

    get_dist_root() resolves REPO_ROOT/frontend/dist where REPO_ROOT is the
    parent of api/ — i.e. site-packages when installed. The wheel must place
    the app at frontend/dist/ relative to api/ so an installed release serves it.
    """
    _, extract_dir = extracted_wheel
    index = extract_dir / "frontend" / "dist" / "index.html"
    assert index.exists(), f"installed layout missing React index: {index}"
    html = index.read_text(encoding="utf-8")
    assert '<div id="root"></div>' in html
    assert "src/main.tsx" in html or "/assets/" in html
