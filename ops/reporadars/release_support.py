"""Small filesystem contracts shared by reversible release activation."""
import hashlib
import json
import os
from pathlib import Path


def unit_snapshot(target, desired, previous):
    """Replace only our new unit or the unit shipped by the active release."""
    target, desired, previous = map(Path, (target, desired, previous))
    new = desired.read_bytes()
    if target.is_symlink():
        raise RuntimeError(f"Refusing symlinked unit: {target.name}")
    before = target.read_bytes() if target.exists() else None
    known = previous.read_bytes() if previous.is_file() else None
    if before is not None and before != new and before != known:
        raise RuntimeError(f"Installed unit differs from active release: {target.name}")
    return before


def restore_unit(target, before):
    target = Path(target)
    if before is None:
        target.unlink(missing_ok=True)
    else:
        target.write_bytes(before)
        os.chmod(target, 0o644)


def release_manifest(release):
    """Hash packaged files and record links; secrets live outside the release."""
    release = Path(release)
    files, links = {}, {}
    for filename in sorted(release.rglob("*")):
        name = filename.relative_to(release).as_posix()
        if name == "release-manifest.json":
            continue
        if filename.is_symlink():
            links[name] = os.readlink(filename)
        elif filename.is_file():
            digest = hashlib.sha256()
            with filename.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
            files[name] = digest.hexdigest()
    data = {"schemaVersion": 1, "files": files, "links": links}
    destination = release / "release-manifest.json"
    destination.write_text(json.dumps(data, sort_keys=True) + "\n")
    return hashlib.sha256(destination.read_bytes()).hexdigest()
