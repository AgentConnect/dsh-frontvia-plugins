#!/usr/bin/env python3
"""Start owned real services, then run the DSH Web product tests."""
import argparse
import json
from pathlib import Path
import os
import re
import shutil
import subprocess
import sys

def dsh_node(environment):
    node = shutil.which(environment.get("FRONTVIA_DSH_TEST_NODE", "node"), path=environment.get("PATH"))
    if not node:
        raise ValueError("Set FRONTVIA_DSH_TEST_NODE to a Node.js executable or add node to PATH.")
    version = subprocess.check_output([node, "--version"], text=True).strip()
    match = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)", version)
    if not match or tuple(map(int, match.groups())) < (24, 9, 0):
        raise ValueError(f"The DSH runner requires Node.js 24.9.0 or later, found {version}.")
    return Path(node).resolve(), version


def core_node(environment):
    configured = environment.get("FRONTVIA_CORE_TEST_NODE")
    if configured:
        node = shutil.which(configured, path=environment.get("PATH"))
    else:
        mise = shutil.which("mise", path=environment.get("PATH"))
        node = subprocess.check_output([mise, "exec", "node@22.23.1", "--", "node", "-p", "process.execPath"],
                                       env=environment, text=True).strip() if mise else None
    if not node or subprocess.check_output([node, "--version"], text=True).strip() != "v22.23.1":
        raise ValueError("Set FRONTVIA_CORE_TEST_NODE to Node.js 22.23.1 or use mise with node@22.23.1 installed.")
    return Path(node).resolve()


def check_live_inputs(plugin, environment):
    default_state = plugin / ".local/identity/awiki-me"
    auth = plugin / environment.get("FRONTVIA_IDENTITY_TEST_AUTH_FILE", default_state / "auth.json")
    state = plugin / environment.get("FRONTVIA_IDENTITY_TEST_STATE", default_state)
    missing = []
    if not auth.is_file():
        missing.append("FRONTVIA_IDENTITY_TEST_AUTH_FILE or .local/identity/awiki-me/auth.json")
    if not (state / "enrollment.json").is_file():
        missing.append("FRONTVIA_IDENTITY_TEST_STATE with the published test identity enrollment")
    if not environment.get("DEEPSEEK_API_KEY", "").strip():
        missing.append("DEEPSEEK_API_KEY")
    if not shutil.which("claude", path=environment.get("PATH")):
        missing.append("claude on PATH")
    if missing:
        raise ValueError("Supply the live DSH test inputs " + ", ".join(missing))

def site_configuration(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077:
        raise ValueError("--site-config requires an owner-only regular file")
    configuration = path.resolve(strict=True)
    value = json.loads(configuration.read_text())
    if not isinstance(value, dict) or value.get("liveStore") is not True or value.get("suite") != "dsh-ucp-full":
        raise ValueError("--site-config requires an explicit liveStore full flow")
    if "existingAftersales" in value:
        existing = value["existingAftersales"]
        uuid = r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}"
        if (not isinstance(existing, dict) or set(existing) != {"orderId", "caseId", "state"}
                or existing["state"] not in ("pending_merchant", "waiting_return", "refunded")
                or any(not isinstance(existing[key], str) or not re.fullmatch(uuid, existing[key])
                       for key in ("orderId", "caseId"))
                or ("merchantCancellation" in value and existing["state"] != "pending_merchant")):
            raise ValueError("existingAftersales requires an original order, case and supported state")
    if "merchantCancellation" in value:
        cancellation = value["merchantCancellation"]
        if (not isinstance(cancellation, dict) or set(cancellation) != {"amountMinor", "shippingMinor", "currency"}
                or cancellation["currency"] not in ("CNY", "USD")
                or any(not isinstance(cancellation[field], str) or not re.fullmatch(r"[1-9]\d{0,13}", cancellation[field])
                       for field in ("amountMinor", "shippingMinor"))
                or int(cancellation["shippingMinor"]) >= int(cancellation["amountMinor"])):
            raise ValueError("merchantCancellation requires a supported currency and an amount including nonzero original shipping")
    return configuration


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    suites = parser.add_mutually_exclusive_group()
    suites.add_argument("--ucp", action="store_true", help="run the PAP 1.0/UCP nonpayment storefront (default)")
    suites.add_argument("--ucp-full", action="store_true", help="run the PAP 1.0/UCP purchase using the isolated Mock channel")
    suites.add_argument("--site-config", type=Path, help="run the full DSH flow against a dedicated HTTPS Mock store with an independent facts observer")
    parser.add_argument("--preflight-only", action="store_true", help="verify the selected DSH Node.js and Chromium")
    args = parser.parse_args()
    plugin = Path(__file__).resolve().parents[3]
    core = Path(os.environ.get("FRONTVIA_CORE_ROOT", str(plugin.parent / "frontvia-core"))).resolve()
    try:
        node, version = dsh_node(os.environ)
        site = site_configuration(args.site_config) if args.site_config else None
        if not args.preflight_only:
            check_live_inputs(plugin, os.environ)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.error(str(error))
    print(f"DSH Node.js {version}: {node}", flush=True)
    # Check the browser before creating any service or identity resources.
    browser_check = """
const {chromium}=require(process.argv[1]);
(async()=>{
  const executablePath=process.env.CHROMIUM_PATH;
  const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(executablePath?{executablePath}:{})});
  await browser.close();
})().catch(()=>{
  console.error('Supply CHROMIUM_PATH or install the pinned Chromium from Core web/ with node node_modules/playwright-core/cli.js install chromium.');
  process.exitCode=1;
});
"""
    subprocess.run([str(node), "-e", browser_check, str(core / "web/node_modules/playwright-core")], check=True)
    if args.preflight_only:
        return 0
    try:
        core_executable = core_node(os.environ) if site is None else None
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.error(str(error))
    if core_executable:
        print(f"Core Node.js v22.23.1: {core_executable}", flush=True)
    environment = {**os.environ, "FRONTVIA_CORE_ROOT": str(core), "FRONTVIA_TEST_PLUGIN_ROOT": str(plugin),
                   "FRONTVIA_DSH_TEST_NODE": str(node)}
    dsh_environment = {**environment, "PATH": str(node.parent) + os.pathsep + os.environ["PATH"]}
    subprocess.run([str(node), "--import", "tsx", "scripts/pap10-core-check.mjs", "--preflight"],
                   cwd=plugin, env=dsh_environment, check=True)
    # Always test freshly built local packages, not a previous manifest's bundles.
    for script in ("build", "pack:local"):
        subprocess.run(["corepack", "pnpm", script], cwd=plugin, env=dsh_environment, check=True)
    if site:
        return subprocess.call([str(node), "--import", "tsx", "scripts/pap10-core-check.mjs", str(site)],
                               cwd=plugin, env=dsh_environment)
    subprocess.run(["cargo", "build", "--manifest-path", str(core / "platform/Cargo.toml"),
                    "--locked", "-p", "frontvia-platform", "--bin", "frontvia-platform"], env=environment, check=True)
    command = [sys.executable, str(core / "platform/tests/pap03/commerce.py")]
    command += ["--suite", "dsh-ucp-full", "--typescript-buyer"] if args.ucp_full else ["--suite", "dsh-ucp"]
    return subprocess.call(command, cwd=core,
                           env={**environment, "PATH": str(core_executable.parent) + os.pathsep + os.environ["PATH"]})


if __name__ == "__main__":
    raise SystemExit(main())
