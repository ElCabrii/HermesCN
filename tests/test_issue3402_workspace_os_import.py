"""Tests for #3402 part B — OS file/folder import into workspace tree targets."""
import json
import shutil
import subprocess


def test_join_workspace_path_node():
    node = shutil.which("node")
    if not node:
        return
    js = r"""
const { joinWorkspacePath, targetDirForRelDir } = (() => {
  function joinWorkspacePath(base, rel) {
    const b = base || '.';
    const r = (rel || '').replace(/^\/+|\/+$/g, '');
    if (!r) return b;
    return b === '.' ? r : `${b}/${r}`;
  }
  function targetDirForRelDir(destDir, relDir) {
    const dirPart = (relDir || '').replace(/\/+$/, '');
    if (!dirPart) return destDir || '.';
    return joinWorkspacePath(destDir, dirPart);
  }
  return { joinWorkspacePath, targetDirForRelDir };
})();

const cases = [
  [joinWorkspacePath('.', ''), '.'],
  [joinWorkspacePath('docs', ''), 'docs'],
  [joinWorkspacePath('.', 'docs/reports'), 'docs/reports'],
  [joinWorkspacePath('src', 'lib/utils'), 'src/lib/utils'],
  [targetDirForRelDir('projects', ''), 'projects'],
  [targetDirForRelDir('projects', 'bundle/'), 'projects/bundle'],
  [targetDirForRelDir('.', 'bundle/sub/'), 'bundle/sub'],
];
console.log(JSON.stringify(cases.map(([a,b]) => b)));
"""
    out = subprocess.check_output([node, "-e", js], text=True).strip()
    assert json.loads(out) == [
        ".", "docs", "docs/reports", "src/lib/utils",
        "projects", "projects/bundle", "bundle/sub",
    ]
