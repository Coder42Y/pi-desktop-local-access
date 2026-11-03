import copy
import hashlib
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest


def digest(data):
    return hashlib.sha256(data).hexdigest()


class ReleaseAssetBridgeTests(unittest.TestCase):
    def setUp(self):
        script = Path(__file__).with_name("release-asset-bridge.py")
        self.assertTrue(script.is_file(), "The release asset bridge is not implemented")
        spec = importlib.util.spec_from_file_location("release_asset_bridge", script)
        self.bridge = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.bridge)
        self.directory = tempfile.TemporaryDirectory(dir=os.environ.get("PI_SCRATCH_DIR"))
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.chunks = self.root / "chunks"
        self.chunks.mkdir()
        self.output = self.root / "output"
        self.manifest = {"version": 1, "release_tag": "local-v0.21.0-1", "files": [{
            "name": "sample.dmg", "size": 4, "sha256": digest(b"ABCD"), "parts": [
                {"name": "sample.dmg.part0000", "size": 2, "sha256": digest(b"AB")},
                {"name": "sample.dmg.part0001", "size": 2, "sha256": digest(b"CD")},
            ],
        }]}
        (self.chunks / "sample.dmg.part0000").write_bytes(b"AB")
        (self.chunks / "sample.dmg.part0001").write_bytes(b"CD")

    def validate(self):
        return self.bridge.validate_manifest(self.manifest, "local-v0.21.0-1")

    def assemble(self):
        return self.bridge.assemble_assets(self.validate(), self.chunks, self.output)

    def test_assembles_verified_parts_into_the_original_file(self):
        files = self.assemble()
        self.assertEqual([p.name for p in files], ["sample.dmg"])
        self.assertEqual(files[0].read_bytes(), b"ABCD")

    def test_rejects_path_traversal_in_asset_names(self):
        self.manifest["files"][0]["name"] = "../sample.dmg"
        with self.assertRaises(ValueError):
            self.validate()

    def test_rejects_parts_from_another_asset(self):
        self.manifest["files"][0]["parts"][0]["name"] = "other.dmg.part0000"
        with self.assertRaises(ValueError):
            self.validate()

    def test_rejects_reordered_parts(self):
        self.manifest["files"][0]["parts"].reverse()
        with self.assertRaises(ValueError):
            self.validate()

    def test_rejects_inconsistent_total_size(self):
        self.manifest["files"][0]["size"] = 5
        with self.assertRaises(ValueError):
            self.validate()

    def test_rejects_a_manifest_for_a_different_release(self):
        self.manifest["release_tag"] = "local-v0.21.0-0"
        with self.assertRaises(ValueError):
            self.validate()

    def test_rejects_duplicate_asset_names(self):
        self.manifest["files"].append(copy.deepcopy(self.manifest["files"][0]))
        with self.assertRaises(ValueError):
            self.validate()

    def test_rejects_non_installer_assets(self):
        self.manifest["files"][0]["name"] = "payload.py"
        with self.assertRaises(ValueError):
            self.validate()

    def test_rejects_corrupted_part_bytes(self):
        (self.chunks / "sample.dmg.part0000").write_bytes(b"ZZ")
        with self.assertRaises(ValueError):
            self.assemble()

    def test_rejects_a_missing_part(self):
        (self.chunks / "sample.dmg.part0001").unlink()
        with self.assertRaises(FileNotFoundError):
            self.assemble()

    def test_rejects_wrong_final_digest_even_when_parts_are_valid(self):
        self.manifest["files"][0]["sha256"] = "0" * 64
        with self.assertRaises(ValueError):
            self.assemble()

    def test_rejects_a_part_symlink(self):
        part = self.chunks / "sample.dmg.part0000"
        part.unlink()
        outside = self.root / "outside"
        outside.write_bytes(b"AB")
        part.symlink_to(outside)
        with self.assertRaises(ValueError):
            self.assemble()

    def test_incomplete_starter_may_have_the_full_announced_size(self):
        self.assertTrue(self.bridge.is_incomplete_asset({"state": "starter", "size": 4194304, "digest": None}))

    def test_uploaded_assets_are_never_classified_as_incomplete(self):
        self.assertFalse(self.bridge.is_incomplete_asset({"state": "uploaded", "size": 4194304, "digest": "sha256:" + "a" * 64}))
        self.assertFalse(self.bridge.is_incomplete_asset({"state": "uploaded", "size": 0, "digest": None}))


if __name__ == "__main__":
    unittest.main()
