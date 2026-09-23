from pathlib import Path
import json
import subprocess
import textwrap

BASE = 'a324937e47a9f54bf9e24d26dab9c3f3d481d24f'
HELPERS = {'.github/maintenance/node-compat.py', '.github/workflows/prepare-node-compat.yml'}
subprocess.run(['git', 'merge-base', '--is-ancestor', BASE, 'HEAD'], check=True)
changed = set(subprocess.check_output(['git', 'diff', '--name-only', BASE, 'HEAD'], text=True).splitlines())
assert changed <= HELPERS, f'Unexpected baseline changes: {changed}'

def read(path):
    return Path(path).read_text(encoding='utf-8')

def write(path, value):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(value.encode('utf-8'))

def replace(path, old, new):
    source = read(path)
    assert source.count(old) == 1, f'Unexpected source structure: {path}: {old}'
    write(path, source.replace(old, new, 1))

def append(path, value):
    write(path, read(path).rstrip() + '\n\n' + textwrap.dedent(value).strip() + '\n')

write('.node-version', '24\n')
replace('.github/workflows/ci.yml', '        node: [18, 22]', '        node: [22, 24, 26]')
replace('.github/workflows/ci.yml', '          node-version: ${{ matrix.node }}', '          node-version: ${{ matrix.node }}\n          check-latest: true')
replace('.github/workflows/ci.yml', '          node-version: 22', '          node-version-file: .node-version\n          check-latest: true')
replace('.github/workflows/ci.yml', '        run: npm test\n\n  package-skill:', '''        run: npm test
      - name: Record actual compatibility runtime
        run: |
          node --version
          npm --version
      - name: Smoke-test committed release ZIPs on this Node version
        run: python scripts/smoke-release-packages.py --expected-node ${{ matrix.node }}

  package-skill:''')
replace('.github/workflows/release.yml', '          node-version: 22', '          node-version-file: .node-version\n          check-latest: true')
replace('.github/workflows/release.yml', '      - "package.json"', '      - "package.json"\n      - ".node-version"\n      - "scripts/smoke-release-packages.py"')
replace('.github/workflows/release.yml', '      - name: Create or update a draft release', '''      - name: Smoke-test the exact release ZIPs on the build LTS
        if: steps.existing.outputs.exists != 'true' || steps.existing.outputs.draft == 'true'
        run: python scripts/smoke-release-packages.py --expected-node 24

      - name: Create or update a draft release''')
package = json.loads(read('package.json'))
assert package['version'] == '0.11.0' and package['engines']['node'] == '>=18'
package['version'] = '0.12.0'
package['engines']['node'] = '>=22'
package['scripts']['test'] += ' dist/tests/node-compatibility.test.js'
write('package.json', json.dumps(package, ensure_ascii=False, indent=2) + '\n')
lock = json.loads(read('package-lock.json'))
lock['version'] = lock['packages']['']['version'] = package['version']
lock['packages']['']['engines']['node'] = package['engines']['node']
write('package-lock.json', json.dumps(lock, ensure_ascii=False, indent=2) + '\n')

write('scripts/smoke-release-packages.py', textwrap.dedent('''\
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
                        and '\\\\' not in name and ':' not in name,
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
        match = re.fullmatch(r'v(\\d+)\\.\\d+\\.\\d+', version)
        require(match is not None and int(match.group(1)) == args.expected_node,
                'Unexpected Node runtime: ' + version)
        package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
        artifacts = ROOT / 'artifacts'
        checksums: dict[str, str] = {}
        for line in (artifacts / 'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines():
            entry = re.fullmatch(r'([0-9A-Fa-f]{64})  ([^/\\\\]+)', line)
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
    '''))
write('tests/node-compatibility.test.ts', textwrap.dedent('''\
    import assert from "node:assert/strict";
    import { readFile } from "node:fs/promises";
    import test from "node:test";

    test("Node compatibility matrix covers maintained lines on Windows and Linux", async () => {
      const ci = await readFile(".github/workflows/ci.yml", "utf8");
      assert.match(ci, /os: \\[ubuntu-latest, windows-latest\\]/);
      assert.match(ci, /node: \\[22, 24, 26\\]/);
      assert.match(ci, /check-latest: true/);
      assert.match(ci, /run: npm test/);
      assert.match(ci, /smoke-release-packages\\.py --expected-node \\$\\{\\{ matrix\\.node \\}\\}/);
      assert.match(ci, /needs: build-and-test/);
    });

    test("Package and release builds share the explicit Node 24 LTS version file", async () => {
      assert.equal((await readFile(".node-version", "utf8")).trim(), "24");
      for (const path of [".github/workflows/ci.yml", ".github/workflows/release.yml"]) {
        const workflow = await readFile(path, "utf8");
        assert.match(workflow, /node-version-file: \\.node-version/);
        assert.doesNotMatch(workflow, /node-version: (18|22)(?:\\r?\\n|$)/);
      }
      const release = await readFile(".github/workflows/release.yml", "utf8");
      assert.match(release, /smoke-release-packages\\.py --expected-node 24/);
    });

    test("Root and lockfile agree on the maintained minimum without upgrading dependencies", async () => {
      const root = JSON.parse(await readFile("package.json", "utf8"));
      const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
      assert.equal(root.engines.node, ">=22");
      assert.deepEqual(root.engines, lock.packages[""].engines);
      assert.equal(root.version, lock.version);
      assert.equal(root.version, lock.packages[""].version);
      // Node 22 types intentionally remain the lowest supported API baseline.
      assert.match(root.devDependencies["@types/node"], /22/);
    });
    '''))

notes = '''# v0.12.0 — Node.js 22 / 24 / 26 兼容性

## 变化

- CI 从 Windows/Linux × Node 18/22 改为 Node 22/24/26，共六种环境；每组运行完整类型检查、回归测试及发布 ZIP 的离线启动检查，不只是安装成功。
- `.node-version` 固定主要构建系列为 24 LTS；打包和 Release 工作流共同读取，`check-latest` 获取该主版本下的最新补丁。Node 26 Current 也作为正式必过测试，不使用 continue-on-error。
- 每组直接解压已提交的两版 ZIP，检查 SHA-256、版本/引擎声明、安全默认值，并运行完整版 CLI help、三模型配置读取和 Direct dispatch。测试不调用模型、Codex、登录或修改用户配置。
- Node.js 运行时最低声明由 18 提升到 22；Node 18/20 不再属于维护范围，所以使用次版本 0.12.0。`>=22` 是最低版本声明，不代表对未来所有主版本的兼容保证；本次验证范围明确为 22、24、26 的测试时最新补丁版本。
- 保持 Node 22 类型定义作为最低 API 基线，不升级 npm 依赖，不修改三模型调度、宿主权限继承、沙箱或真实执行开关。

## 使用与升级

推荐 Node.js 24 LTS；已使用 Node.js 26 的用户无需为 Qing 降级。只需安装一个版本。Node 22 仍受测试支持。标准版和完整版的原生桌面用法不需要 Node.js；只有可选 Relay 运行时和源码开发需要它。

标准版技能内容不变，其 ZIP 保持字节一致；完整版的运行时元数据与使用说明更新并重新打包。升级前备份自定义 relay.user.json。本发布不会自动修改系统 Node.js、用户技能安装目录或 config.toml。

具体执行版本与结论以本发布对应的六组 CI 和 Release 日志为准。单元测试和离线产物检查不等于用户账户真实模型 E2E 或性能基准。

官方生命周期核对：2026-09-23，https://nodejs.org/en/about/previous-releases 。Node 22/24 为 LTS，26 为 Current；18/20 为 EOL。

English: test the shipped packages and complete source suite on Node 22/24/26 for both Windows and Linux, build on Node 24 LTS, and retire the EOL Node 18/20 support baseline. No model routing, permission or dependency upgrades.
'''
write('docs/release-notes-v0.12.0.md', notes)
write('docs/node-support.md', '''# Node.js 支持范围

当前主动测试的主版本：**22、24、26**。推荐 **24 LTS**；26 Current 也需要通过全部兼容测试。安装一个版本即可，不要求同时安装多个版本。`.node-version` 表示发布构建所用的 24 系列，不限制用户必须使用 24。

最低运行时声明是 `>=22`，当前兼容证据限于 Windows/Linux 上 22/24/26 测试时的最新补丁版本，不把最低声明当成所有未来版本已通过的证明。Node 18/20 已退出本项目维护范围；历史发行物及历史测试记录不改写。

CI 每个主版本都运行类型检查和完整回归测试，还通过 `python scripts/smoke-release-packages.py --expected-node <22|24|26>` 校验并解压发布 ZIP，运行真正的预编译 CLI 的 help、模型配置读取和 Direct 分派。Python 只供 CI/开发使用，不是用户运行技能的新增依赖。发布打包与 Release 使用同一个 `.node-version`，同时保留逐文件内容、ZIP 字节及 SHA-256 一致性检查。

本仓库继续使用 Node 22 类型定义，以避免意外依赖高版本专有 API。GitHub Actions 自身的 action runtime 与被测试软件的 Node.js 版本是两个概念；测试程序的实际版本在 CI 日志中记录。

标准版没有 runtime；完整版仅在使用独立 Relay 时需要 Node.js。普通原生父任务和子智能体不因技能安装而新增 Node.js 依赖。

本次没有运行真实模型账户、修改系统 Node.js 或用户 config.toml。升级前备份定制配置。

官方生命周期：https://nodejs.org/en/about/previous-releases （核对：2026-09-23）。
''')
for path, heading, summary, old, new in [
    ('README.md', '## v0.12.0 — Node.js 最新版兼容',
     'Windows/Linux × Node.js 22、24、26 完整测试；统一以 24 LTS 构建，并直接验证发布 ZIP。最低运行时声明为 22，标准版仍不需要 Node.js。',
     '需要 Node.js 18 或更新版本：', '开发与可选 Relay 推荐 Node.js 24 LTS；CI 覆盖 22、24、26，最低声明为 22。标准版不需要 Node.js：'),
    ('README.en.md', '## v0.12.0 — Current Node.js compatibility',
     'Full tests on Windows/Linux with Node.js 22, 24 and 26; builds use 24 LTS and each matrix job smoke-tests the shipped ZIPs. The runtime minimum is 22; Standard remains Node-free.',
     'Node.js 18 or newer is required:', 'Node.js 24 LTS is recommended for development and the optional Relay; CI covers 22, 24 and 26, with a minimum of 22. Standard needs no Node.js:')]:
    source = read(path)
    assert old in source, f'Missing existing Node requirement in {path}'
    source = source.replace(old, new, 1)
    first, rest = source.split('\n', 1)
    source = first + '\n\n' + heading + '\n\n' + summary + ' [Details](docs/node-support.md) · [Release](docs/release-notes-v0.12.0.md)\n' + rest
    # Update navigation once, not old release headings or historical notes.
    if path == 'README.md':
        source = source.replace('[English](README.en.md) · [v0.11.0 发布说明](docs/release-notes-v0.11.0.md)', '[English](README.en.md) · [v0.12.0 发布说明](docs/release-notes-v0.12.0.md)', 1)
    else:
        source = source.replace('[简体中文](README.md) · [v0.11.0 release notes](docs/release-notes-v0.11.0.md)', '[简体中文](README.md) · [v0.12.0 release notes](docs/release-notes-v0.12.0.md)', 1)
    write(path, source)
changelog = read('CHANGELOG.md').replace('当前稳定版本为 `v0.11.0`', '当前稳定版本为 `v0.12.0`')
assert '## 0.11.0 - ' in changelog
write('CHANGELOG.md', changelog.replace('## 0.11.0 - ', '''## 0.12.0 - 2026-09-23

### Changed

- Test Node.js 22/24/26 on Windows and Linux, including the exact shipped CLI archives.
- Use .node-version (24 LTS) for package and release builds; record actual tested patch versions.
- Raise the maintained runtime minimum to Node 22 and retire Node 18/20 from supported CI.
- Synchronize lockfile/runtime metadata without upgrading dependencies or changing model/permission behavior.
- Standard ZIP content unchanged. See docs/node-support.md and docs/release-notes-v0.12.0.md.

## 0.11.0 - ''', 1))
append('CONTRIBUTING.md', '''## Node.js compatibility
Use Node.js 24 LTS for local builds (see `.node-version`). CI must pass on Windows/Linux with Node.js 22, 24 and 26, including the shipped-package smoke check. Node 22 types remain the lowest supported API baseline. Do not claim compatibility from `engines` alone or skip a failing newest-version job. Python is required only for CI/development package smoke checks, not installed skills.''')
append('docs/codex-integration.md', '''## Node.js 运行环境
可选 Relay 支持本项目 CI 验证的 Node.js 22、24、26；建议 24 LTS，不要求降级已安装的 26。主要构建系列由 `.node-version` 指定，源码与预编译发布 ZIP 在六组平台/版本组合上测试。最低声明为 22，不再以 EOL 18/20 为支持基线。标准版及原生桌面调用不需要 Node.js。详情见 [Node.js 支持范围](node-support.md)。''')
append('.agents/skills/qing-agent-orchestrator-full/references/codex-exec.md', '''## Node.js runtime
The optional standalone Relay is tested on Node.js 22, 24 and 26 (Windows/Linux); use the latest patch in one of these lines. Node.js 24 LTS is the recommended build/runtime baseline; 26 does not require a downgrade. The minimum engine declaration is 22, not a guarantee for untested future major versions. Native desktop workflows and the Standard edition do not need Node.js. Do not install or change the user's system runtime merely to load this skill.''')
# No task-execution or authorization source may change for this maintenance task.
assert not subprocess.check_output(['git', 'diff', '--name-only', BASE, '--', 'src', 'config', 'schemas'], text=True).strip()
print('Prepared Node.js 22/24/26 verification, Node 24 builds and synchronized 0.12.0 metadata.')
