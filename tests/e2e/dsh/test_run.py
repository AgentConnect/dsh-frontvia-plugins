import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("dsh_runner", Path(__file__).with_name("run.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerPreflight(unittest.TestCase):
    @patch.object(runner.subprocess, "check_output", return_value="v24.12.0\n")
    @patch.object(runner.shutil, "which", return_value="/test/dsh/node")
    def test_uses_path_default_and_explicit_override(self, which, version):
        self.assertEqual(runner.dsh_node({"PATH": "/test/dsh"})[1], "v24.12.0")
        which.assert_called_once_with("node", path="/test/dsh")
        self.assertEqual(runner.dsh_node({"PATH": "/test/dsh", "FRONTVIA_DSH_TEST_NODE": "/test/dsh/node"})[0].name, "node")
        which.assert_called_with("/test/dsh/node", path="/test/dsh")
        version.assert_called_with(["/test/dsh/node", "--version"], text=True)

    @patch.object(runner.subprocess, "check_output", return_value="v22.23.1\n")
    @patch.object(runner.shutil, "which", return_value="/test/core/node")
    def test_rejects_core_node_for_dsh_but_accepts_it_for_core(self, which, version):
        with self.assertRaisesRegex(ValueError, "24.9.0"):
            runner.dsh_node({"PATH": "/test/core"})
        self.assertEqual(runner.core_node({"PATH": "/test/core", "FRONTVIA_CORE_TEST_NODE": "/test/core/node"}).name, "node")

    @patch.object(runner.shutil, "which", return_value=None)
    def test_missing_executable_fails_before_starting_services(self, which):
        with self.assertRaisesRegex(ValueError, "FRONTVIA_DSH_TEST_NODE"):
            runner.dsh_node({"PATH": "/test/missing"})


if __name__ == "__main__":
    unittest.main()
