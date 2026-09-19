#!/usr/bin/env python3
"""Check, build and package source/assets locally or in CI; never package live data."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--output", default="artifacts/release")
args = parser.parse_args()
output = (root / args.output).resolve()
output.mkdir(parents=True, exist_ok=True)
for command in (["npm", "run", "check"], ["npm", "run", "build"]):
    subprocess.run(command, cwd=root, check=True)

commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=root, text=True).strip())
release = 'djdesk-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + commit[:12]
identity = {'release': release, 'source_commit': commit, 'source_dirty': dirty,
            'github_run_id': os.environ.get('GITHUB_RUN_ID')}
(root / 'apps/client/dist/release.json').write_text(json.dumps(identity, indent=2) + '\n')

files = set(subprocess.check_output(
    ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=root
).decode().split("\0"))
for directory in ("apps/client/dist", "packages/domain/dist"):
    files.update(str(p.relative_to(root)) for p in (root / directory).rglob("*") if p.is_file())
allowed = {"apps", "packages", "deploy", "docs", "scripts", ".github"}
root_files = {"package.json", "package-lock.json", ".node-version", ".npmrc", ".env.example", "README.md", "AGENTS.md", "LICENSE"}
selected = []
for file in sorted(files):
    path = Path(file)
    if not file or not (root / file).is_file():
        continue
    if len(path.parts) == 1 and file not in root_files:
        continue
    if len(path.parts) > 1 and path.parts[0] not in allowed:
        continue
    if "node_modules" in path.parts or any(p.startswith(".env") and p != ".env.example" for p in path.parts):
        continue
    if any(s in file.lower() for s in (".sqlite", "access-link", ".pem", ".key", ".zip", ".tgz", ".bak")):
        continue
    selected.append(file)

archive = output / f"{release}.tgz"
with tarfile.open(archive, "w:gz") as tar:
    for file in selected:
        tar.add(root / file, arcname=file, recursive=False)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(output / "release.json").write_text(json.dumps({**identity, "sha256": digest, "files": selected}, indent=2) + "\n")
print(f"Archive: {archive}\nRelease: {release}\nSHA-256: {digest}")
