from __future__ import annotations

import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


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
        ),
    )
    return repo_copy


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
    tmp = tmp_path_factory.mktemp("packaged-runtime")
    repo_copy = _copy_repo_without_heavy_dirs(tmp)
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
        assert "static/__init__.py" in names
        assert "static/index.html" in names
        assert "static/ui.js" in names
        assert "static/style.css" in names
        assert "static/vendor/smd.min.js" in names
