#!/usr/bin/env python3
"""Server side of the GitHub deploy: receive a built editor and publish it into <project>/html.

Install root-owned outside the project folder; it runs as the owner of that folder (see docs/deploy.md).
stdin: one line with the commit id, followed by a .tar.gz with the finished site.
"""
import datetime
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

REQUIRED = ("index.html", "sw.js", "config.json", "compatibility.json")


def publish(source, target):
    # --delay-updates: index.html and sw.js never point at assets that are not there yet.
    # The folder itself stays (it is mounted into the container).
    subprocess.run(["rsync", "-a", "--delete", "--delay-updates", f"{source}/", f"{target}/"], check=True)


def receive(project, stream):
    commit = stream.readline(100).decode("ascii", "replace").strip()
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("First line must be a full commit id")
    html = project / "html"
    if not html.is_dir():
        raise ValueError(f"{html} is missing")
    with (project / ".deploy.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with tempfile.TemporaryDirectory(dir=project, prefix=".incoming-") as incoming:
            site = Path(incoming) / "site"
            site.mkdir()
            with tarfile.open(fileobj=stream, mode="r|gz") as archive:
                archive.extractall(site, filter="data")  # refuses paths and links that leave the folder
            if any(path.is_symlink() for path in site.rglob("*")):
                raise ValueError("Links are not allowed in the site")
            missing = [name for name in REQUIRED if not (site / name).is_file()]
            if missing:
                raise ValueError(f"Incomplete upload, missing: {', '.join(missing)}")
            for path in [site, *site.rglob("*")]:  # the web server in the container must be able to read it
                path.chmod(0o755 if path.is_dir() else 0o644)
            previous = project / "html.previous"
            shutil.rmtree(previous, ignore_errors=True)
            shutil.copytree(html, previous)
            publish(site, html)
        release = {
            "commit": commit,
            "index_sha256": hashlib.sha256((html / "index.html").read_bytes()).hexdigest(),
            "deployed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        }
        (project / "release.json").write_text(json.dumps(release, indent=2) + "\n")
    return release


if __name__ == "__main__":
    try:
        project = Path(sys.argv[1])
        os.chdir(project)  # the folder sudo was started in may not be readable
        print(json.dumps(receive(project, sys.stdin.buffer)))
    except Exception as error:
        print(f"Deploy refused: {error}", file=sys.stderr)
        raise SystemExit(1)
