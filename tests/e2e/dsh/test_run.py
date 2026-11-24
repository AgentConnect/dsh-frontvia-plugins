import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
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

    @patch.object(runner.shutil, "which", return_value="/test/claude")
    def test_live_inputs_require_published_identity_and_model_without_reading_secrets(self, which):
        with TemporaryDirectory() as directory:
            plugin = Path(directory)
            with self.assertRaisesRegex(ValueError, "FRONTVIA_IDENTITY_TEST_AUTH_FILE.*FRONTVIA_IDENTITY_TEST_STATE.*DEEPSEEK_API_KEY"):
                runner.check_live_inputs(plugin, {})
            auth = plugin / "test-auth.json"
            auth.touch()
            state = plugin / "existing-test-state"
            state.mkdir()
            (state / "enrollment.json").touch()
            runner.check_live_inputs(plugin, {
                "FRONTVIA_IDENTITY_TEST_AUTH_FILE": auth.name,
                "FRONTVIA_IDENTITY_TEST_STATE": str(state),
                "DEEPSEEK_API_KEY": "fixture",
            })
            which.assert_called_with("claude", path=None)

    def test_site_configuration_requires_explicit_full_flow_and_private_input(self):
        with TemporaryDirectory() as directory:
            config = Path(directory) / "site.json"
            config.write_text('{"liveStore":false,"suite":"dsh-ucp-full"}')
            config.chmod(0o600)
            with self.assertRaisesRegex(ValueError, "explicit liveStore"):
                runner.site_configuration(config)
            config.write_text('{"liveStore":true,"suite":"dsh-ucp-full"}')
            self.assertEqual(runner.site_configuration(config), config.resolve())
            config.chmod(0o644)
            with self.assertRaisesRegex(ValueError, "owner-only"):
                runner.site_configuration(config)

    def test_site_configuration_checks_original_shipping_before_merchant_readback(self):
        with TemporaryDirectory() as directory:
            config = Path(directory) / "site.json"
            config.touch(mode=0o600)
            template = '{"liveStore":true,"suite":"dsh-ucp-full", "merchantCancellation":%s}'
            config.write_text(template % '{"amountMinor":"300","shippingMinor":"200","currency":"CNY"}')
            self.assertEqual(runner.site_configuration(config), config.resolve())
            for invalid in ('null', '{"amountMinor":"300","shippingMinor":"0","currency":"CNY"}',
                            '{"amountMinor":"300","shippingMinor":"300","currency":"CNY"}'):
                with self.subTest(invalid=invalid):
                    config.write_text(template % invalid)
                    with self.assertRaisesRegex(ValueError, "nonzero original shipping"):
                        runner.site_configuration(config)

    def test_existing_case_readback_requires_original_order_and_case(self):
        with TemporaryDirectory() as directory:
            config = Path(directory) / "site.json"
            config.touch(mode=0o600)
            template = '{"liveStore":true,"suite":"dsh-ucp-full","existingAftersales":%s}'
            order = 'c212c540-11e2-4ee7-b8a2-f1af97f860d3'
            case = 'ba113c61-a028-416c-8de8-7ea699e62357'
            valid = '{"orderId":"%s","caseId":"%s","state":"refunded"}' % (order, case)
            config.write_text(template % valid)
            self.assertEqual(runner.site_configuration(config), config.resolve())
            for invalid in ('null', valid.replace(order, 'other'), valid.replace('refunded', 'buy')):
                config.write_text(template % invalid)
                with self.assertRaisesRegex(ValueError, "original order, case and supported state"):
                    runner.site_configuration(config)

if __name__ == "__main__":
    unittest.main()
