import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("release_support", Path(__file__).parents[1] / "ops/reporadars/release_support.py")
support = importlib.util.module_from_spec(spec)
spec.loader.exec_module(support)


class ReleaseContracts(unittest.TestCase):
    def test_upgrade_only_known_unit_and_restore_previous_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            installed, desired, previous = [root / name for name in ["installed", "desired", "previous"]]
            installed.write_bytes(b"old daily timer\n")
            previous.write_bytes(installed.read_bytes())
            desired.write_bytes(b"new hourly timer\n")
            before = support.unit_snapshot(installed, desired, previous)
            installed.write_bytes(desired.read_bytes())
            support.restore_unit(installed, before)
            self.assertEqual(installed.read_bytes(), b"old daily timer\n")
            installed.write_bytes(b"local operator override\n")
            with self.assertRaises(RuntimeError):
                support.unit_snapshot(installed, desired, previous)
            installed.unlink()
            installed.symlink_to(previous)
            with self.assertRaises(RuntimeError):
                support.unit_snapshot(installed, desired, previous)

    def test_manifest_changes_with_packaged_bytes_and_preserves_links(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            file = root / "source.mjs"
            file.write_text("first")
            (root / "alias").symlink_to("source.mjs")
            first = support.release_manifest(root)
            self.assertEqual(first, support.release_manifest(root))
            file.write_text("second")
            self.assertNotEqual(first, support.release_manifest(root))
            self.assertIn('"alias": "source.mjs"', (root / "release-manifest.json").read_text())


if __name__ == "__main__":
    unittest.main()
