"""Reassemble verified release chunks on a GitHub runner; never publish a release."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

MANIFEST_NAME = "UPLOAD-MANIFEST.json"
MAX_PART_SIZE = 4 * 1024 * 1024


def is_incomplete_asset(asset):
    # GitHub may set the announced Content-Length before an upload finishes.
    return bool(asset) and asset.get("state") == "starter"


def valid_hash(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def validate_manifest(manifest, tag):
    if not re.fullmatch(r"local-v\d+\.\d+\.\d+-\d+", tag):
        raise ValueError("Invalid local release tag")
    if not isinstance(manifest, dict) or manifest.get("version") != 1 or manifest.get("release_tag") != tag:
        raise ValueError("Manifest version or release mismatch")
    files = manifest.get("files")
    if not isinstance(files, list) or not 1 <= len(files) <= 8:
        raise ValueError("Invalid installer list")
    seen = set()
    for item in files:
        if not isinstance(item, dict):
            raise ValueError("Invalid installer metadata")
        name = item.get("name")
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*\.(dmg|zip)", name) or name in seen:
            raise ValueError("Invalid or duplicate installer name")
        seen.add(name)
        if type(item.get("size")) is not int or not 0 < item["size"] <= 1024 ** 3 or not valid_hash(item.get("sha256")):
            raise ValueError("Invalid installer size or digest")
        parts = item.get("parts")
        if not isinstance(parts, list) or not 1 <= len(parts) <= 256:
            raise ValueError("Invalid chunk count")
        for index, part in enumerate(parts):
            if not isinstance(part, dict) or part.get("name") != f"{name}.part{index:04d}":
                raise ValueError("Invalid chunk name or order")
            if type(part.get("size")) is not int or not 0 < part["size"] <= MAX_PART_SIZE or not valid_hash(part.get("sha256")):
                raise ValueError("Invalid chunk size or digest")
        if sum(p["size"] for p in parts) != item["size"]:
            raise ValueError("Chunk sizes do not match installer")
    return files


def file_digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def assemble_assets(files, chunks, output):
    output.mkdir(parents=True, exist_ok=False)
    restored = []
    for item in files:
        partial = output / (item["name"] + ".partial")
        final = output / item["name"]
        try:
            with partial.open("xb") as target:
                for part in item["parts"]:
                    source = chunks / part["name"]
                    if source.is_symlink():
                        raise ValueError("Chunk must not be a symlink")
                    if source.stat().st_size != part["size"] or file_digest(source) != part["sha256"]:
                        raise ValueError("Chunk integrity mismatch")
                    with source.open("rb") as stream:
                        for block in iter(lambda: stream.read(1024 * 1024), b""):
                            target.write(block)
            if partial.stat().st_size != item["size"] or file_digest(partial) != item["sha256"]:
                raise ValueError("Restored installer integrity mismatch")
            partial.rename(final)
        except Exception:
            partial.unlink(missing_ok=True)
            raise
        restored.append(final)
    return restored


def gh_json(*arguments):
    return json.loads(subprocess.check_output(["gh", *arguments], text=True))


def list_assets(repo, release_id):
    pages = gh_json("api", "--paginate", "--slurp", f"repos/{repo}/releases/{release_id}/assets?per_page=100")
    return {item["name"]: item for page in pages for item in page}


def download_asset(repo, asset, destination):
    with destination.open("xb") as stream:
        subprocess.run(["gh", "api", "-H", "Accept: application/octet-stream", f"repos/{repo}/releases/assets/{int(asset['id'])}"], stdout=stream, check=True)


def verify_remote(repo, asset, expected, directory):
    if asset.get("state") != "uploaded" or asset.get("size") != expected["size"]:
        raise ValueError("Remote asset state or size mismatch")
    digest = asset.get("digest")
    if digest:
        if digest != "sha256:" + expected["sha256"]:
            raise ValueError("Remote asset digest mismatch")
    else:
        local = directory / (expected["name"] + ".remote-check")
        download_asset(repo, asset, local)
        if file_digest(local) != expected["sha256"]:
            raise ValueError("Downloaded remote asset digest mismatch")
        local.unlink()


def run_bridge(repo, tag):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        raise ValueError("Invalid repository")
    if not re.fullmatch(r"local-v\d+\.\d+\.\d+-\d+", tag):
        raise ValueError("Invalid local release tag")
    pages = gh_json("api", "--paginate", "--slurp", f"repos/{repo}/releases?per_page=100")
    release = next(item for page in pages for item in page if item["tag_name"] == tag)
    if not release.get("draft"):
        raise ValueError("Bridge only operates on draft releases")
    release_id = int(release["id"])
    assets = list_assets(repo, release_id)
    manifest_asset = assets[MANIFEST_NAME]
    if manifest_asset["size"] > 2 * 1024 * 1024:
        raise ValueError("Manifest is too large")
    with tempfile.TemporaryDirectory(prefix="release-bridge-", dir=os.environ.get("RUNNER_TEMP")) as work:
        directory = Path(work)
        manifest_path = directory / MANIFEST_NAME
        download_asset(repo, manifest_asset, manifest_path)
        files = validate_manifest(json.loads(manifest_path.read_text()), tag)
        chunks = directory / "chunks"
        chunks.mkdir()
        for item in files:
            for part in item["parts"]:
                remote = assets[part["name"]]
                if remote.get("state") != "uploaded" or remote.get("size") != part["size"]:
                    raise ValueError("Remote chunk state or size mismatch")
                download_asset(repo, remote, chunks / part["name"])
        restored = assemble_assets(files, chunks, directory / "restored")
        for item, path in zip(files, restored):
            current = list_assets(repo, release_id)
            existing = current.get(item["name"])
            if is_incomplete_asset(existing):
                subprocess.run(["gh", "api", "-X", "DELETE", f"repos/{repo}/releases/assets/{int(existing['id'])}"], check=True)
                existing = None
            if not existing:
                subprocess.run(["gh", "release", "upload", tag, "--repo", repo, str(path)], check=True)
            remote = list_assets(repo, release_id)[item["name"]]
            verify_remote(repo, remote, item, directory)
            print(f"Verified complete installer: {item['name']} sha256={item['sha256']}", flush=True)
        # Never remove transfer inputs until EVERY complete installer is verified.
        for item in files:
            for part in item["parts"]:
                subprocess.run(["gh", "api", "-X", "DELETE", f"repos/{repo}/releases/assets/{int(assets[part['name']]['id'])}"], check=True)
        subprocess.run(["gh", "api", "-X", "DELETE", f"repos/{repo}/releases/assets/{int(manifest_asset['id'])}"], check=True)
        print("Complete installers verified; transfer chunks removed; release remains draft.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--tag", required=True)
    args = parser.parse_args()
    run_bridge(args.repo, args.tag)
