#!/usr/bin/env python3
"""JUUNIBI launcher (Python, stdlib only, Windows/macOS/Linux).

Finds Node.js 20+ (system -> .runtime), downloads a checksum-verified portable
build if missing, then runs scripts/launch.mjs: install -> typecheck -> tests ->
build -> free port -> serve -> open browser.

Usage: python juunibi.py [--dev] [--no-open] [--skip-checks] [--port N]
"""
from __future__ import annotations

import hashlib
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

NODE_VERSION = "22.12.0"
MIN_MAJOR = 20
ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / ".runtime"
NODE_DIR = RUNTIME / "node"


def node_exe(base: Path | None = None) -> str | None:
    if base is None:
        return shutil.which("node")
    for rel in ("node.exe", "bin/node"):
        p = base / rel
        if p.is_file():
            return str(p)
    return None


def node_ok(exe: str | None) -> bool:
    if not exe:
        return False
    try:
        out = subprocess.run([exe, "-v"], capture_output=True, text=True, timeout=20).stdout.strip()
        return int(out.lstrip("v").split(".")[0]) >= MIN_MAJOR
    except (OSError, ValueError, subprocess.SubprocessError):
        return False


def target() -> tuple[str, str]:
    """Return (platform-arch slug, archive extension) for nodejs.org."""
    machine = platform.machine().lower()
    arch = "arm64" if machine in ("arm64", "aarch64") else "x64"
    system = platform.system()
    if system == "Windows":
        return f"win-{arch}", "zip"
    if system == "Darwin":
        return f"darwin-{arch}", "tar.gz"
    if system == "Linux":
        return f"linux-{arch}", "tar.xz"
    sys.exit(f"[ОШИБКА] Платформа {system} не поддерживается автозагрузкой. Установите Node.js: https://nodejs.org")


def download(url: str, dest: Path) -> None:
    with urllib.request.urlopen(url, timeout=60) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)


def install_node() -> str:
    slug, ext = target()
    name = f"node-v{NODE_VERSION}-{slug}"
    base = f"https://nodejs.org/dist/v{NODE_VERSION}"
    RUNTIME.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=RUNTIME) as tmp_s:
        tmp = Path(tmp_s)
        archive = tmp / f"{name}.{ext}"
        print(f"Скачиваю {name}.{ext} ...")
        download(f"{base}/{name}.{ext}", archive)
        sums = urllib.request.urlopen(f"{base}/SHASUMS256.txt", timeout=60).read().decode()
        expected = next((l.split()[0] for l in sums.splitlines() if l.strip().endswith(f" {name}.{ext}")), None)
        if not expected:
            sys.exit("[ОШИБКА] Контрольная сумма не найдена.")
        h = hashlib.sha256()
        with open(archive, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        if h.hexdigest().lower() != expected.lower():
            sys.exit("[ОШИБКА] Контрольная сумма не совпала — установка отменена.")
        print("Распаковываю ...")
        out = tmp / "out"
        if ext == "zip":
            with zipfile.ZipFile(archive) as z:
                for m in z.namelist():  # zip-slip guard
                    if not (out / m).resolve().is_relative_to(out.resolve()):
                        sys.exit("[ОШИБКА] Небезопасный архив.")
                z.extractall(out)
        else:
            with tarfile.open(archive) as t:
                t.extractall(out, filter="data") if sys.version_info >= (3, 12) else t.extractall(out)
        if NODE_DIR.exists():
            shutil.rmtree(NODE_DIR)
        shutil.move(str(out / name), str(NODE_DIR))
    exe = node_exe(NODE_DIR)
    if not node_ok(exe):
        sys.exit("[ОШИБКА] Скачанный Node.js не запускается.")
    return exe  # type: ignore[return-value]


def find_node() -> str:
    exe = node_exe()
    if node_ok(exe):
        return exe  # type: ignore[return-value]
    exe = node_exe(NODE_DIR)
    if node_ok(exe):
        return exe  # type: ignore[return-value]
    print(f"Node.js {MIN_MAJOR}+ не найден. Скачиваю переносную версию в {RUNTIME} ...")
    try:
        return install_node()
    except OSError as e:
        sys.exit(f"[ОШИБКА] Не удалось скачать Node.js ({e}). Проверьте интернет или установите с https://nodejs.org")


def main() -> int:
    node = find_node()
    # make npm (used for dependency install) resolvable from the portable runtime
    node_bin = str(Path(node).parent)
    env = {**os.environ, "PATH": node_bin + os.pathsep + os.environ.get("PATH", "")}
    print("Node.js", subprocess.run([node, "-v"], capture_output=True, text=True).stdout.strip())
    try:
        return subprocess.call([node, str(ROOT / "scripts" / "launch.mjs"), *sys.argv[1:]], cwd=ROOT, env=env)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    rc = main()
    if rc and os.name == "nt":
        input("\nНажмите Enter для выхода...")
    sys.exit(rc)
