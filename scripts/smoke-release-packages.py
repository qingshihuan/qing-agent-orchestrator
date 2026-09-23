"""Verify and run the shipped runtime without installing or invoking Codex.

Python is a CI/development helper only, not a dependency of the skill.
Every run extracts into a fresh temporary directory outside the repository.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import stat
import subprocess
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
ARCHIVES = ('qing-agent-orchestrator-standard.zip', 'qing-agent-orchestrator-full.zip')

def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)

def extract_checked(archive: Path, destination: Path) -> None:
    with zipfile.ZipFile(archive) as source:
        seen: set[str] = set()
        total_bytes = 0
        for entry in source.infolist():
            name = entry.filename
            path = PurePosixPath(name)
            require(bool(name) and not path.is_absolute() and '..' not in path.parts
                    and '\\' not in name and ':' not in name,
                    'Unsafe archive path: ' + name)
            require(name.casefold() not in seen, 'Duplicate archive path: ' + name)
            seen.add(name.casefold())
            require(not stat.S_ISLNK(entry.external_attr >> 16), 'Archive symlink: ' + name)
            total_bytes += entry.file_size
            require(total_bytes <= 32 * 1024 * 1024, 'Unexpectedly large skill archive')
        source.extractall(destination)

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-node', type=int, choices=(22, 24, 26), required=True)
    args = parser.parse_args()
    node = shutil.which('node')
    require(node is not None, 'Node.js is missing from PATH')
    version = subprocess.check_output([node, '--version'], text=True, encoding='utf-8').strip()
    match = re.fullmatch(r'v(\d+)\.\d+\.\d+', version)
    require(match is not None and int(match.group(1)) == args.expected_node,
            'Unexpected Node runtime: ' + version)
    package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    artifacts = ROOT / 'artifacts'
    checksums: dict[str, str] = {}
    for line in (artifacts / 'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines():
        entry = re.fullmatch(r'([0-9A-Fa-f]{64})  ([^/\\]+)', line)
        require(entry is not None, 'Malformed archive checksum record')
        digest, name = entry.groups()
        require(name not in checksums, 'Duplicate archive checksum: ' + name)
        checksums[name] = digest.lower()
    require(set(checksums) == set(ARCHIVES), 'Checksum manifest must name exactly both ZIPs')
    for name in ARCHIVES:
        with (artifacts / name).open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        require(digest == checksums[name], 'Archive checksum mismatch: ' + name)
    with tempfile.TemporaryDirectory(prefix='qing-node-package-') as temporary:
        scratch = Path(temporary)
        standard, full, workspace = scratch / 'standard', scratch / 'full', scratch / 'workspace'
        workspace.mkdir()
        extract_checked(artifacts / ARCHIVES[0], standard)
        extract_checked(artifacts / ARCHIVES[1], full)
        require((standard / 'SKILL.md').is_file(), 'Standard SKILL.md is missing')
        require(not (standard / 'runtime').exists() and not (standard / 'scripts').exists(),
                'Standard edition must remain runtime-free')
        runtime = full / 'runtime'
        shipped = json.loads((runtime / 'package.json').read_text(encoding='utf-8'))
        require(shipped['version'] == package['version'] and shipped['engines'] == package['engines'],
                'Shipped runtime metadata does not match the root package')
        safe_path = runtime / 'config' / 'relay.user.json'
        safe = json.loads(safe_path.read_text(encoding='utf-8'))
        require(safe['executor']['mode'] == 'dry-run' and not safe['executor']['codexExec']['enabled']
                and safe['modelRouting']['mode'] == 'inherit'
                and safe['security']['approvedGateIds'] == [], 'Unsafe packaged defaults')
        cli = runtime / 'dist' / 'src' / 'cli.js'
        def run(*arguments: str) -> str:
            result = subprocess.run([node, str(cli), *arguments], cwd=workspace,
                                    capture_output=True, text=True, encoding='utf-8', timeout=30,
                                    check=True)
            return result.stdout
        require('Qing Agent Orchestrator' in run('help'), 'Packaged CLI help failed')
        listed = json.loads(run('models', 'list', '--config', str(runtime / 'config' / 'relay.gpt6.json')))
        require({candidate['model'] for candidate in listed['candidates']} ==
                {'gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'}, 'Packaged GPT-6 preset mismatch')
        direct = json.loads(run('dispatch', '--edition', 'standard', '--task', '解释这个项目',
                                '--workspace', str(workspace), '--config', str(safe_path),
                                '--no-model-probe', '--compact'))
        require(direct['status'] == 'DIRECT_EXECUTION_REQUIRED', 'Packaged Direct routing failed')
        require(direct['permissionHandling']['grantsPermissions'] is False,
                'Native permission contract must not grant permissions')
        require(not list(workspace.iterdir()) and not list(scratch.rglob('.qing')),
                'Read-only package smoke checks unexpectedly created task state')
    print(json.dumps({'node': version, 'platform': __import__('sys').platform,
                      'packageVersion': package['version'], 'archives': checksums,
                      'checks': ['checksums', 'safe-extraction', 'standard-runtime-free',
                                 'runtime-metadata', 'safe-defaults', 'cli-help',
                                 'gpt6-preset', 'direct-dispatch'],
                      'connectedModelCalls': 0}, indent=2))

if __name__ == '__main__':
    main()
