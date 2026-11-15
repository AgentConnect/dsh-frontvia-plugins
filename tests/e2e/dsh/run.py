#!/usr/bin/env python3
"""Start owned real services, then run the DSH Web product tests."""
import argparse
from pathlib import Path
import os
import subprocess
import sys

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ucp", action="store_true", help="run the PAP 1.0/UCP nonpayment storefront")
    args = parser.parse_args()
    plugin = Path(__file__).resolve().parents[3]
    core = Path(os.environ.get("FRONTVIA_CORE_ROOT", str(plugin.parent / "frontvia-core"))).resolve()
    node = Path.home() / ".nvm/versions/node/v24.12.0/bin/node"
    # Check the browser before creating any service or identity resources.
    browser_check = "const {chromium}=require(process.argv[1]);(async()=>{const b=await chromium.launch({headless:true,args:['--no-sandbox']});await b.close()})().catch(()=>{console.error('Install the matched Chromium: PLAYWRIGHT_SKIP_BROWSER_GC=1 node node_modules/playwright-core/cli.js install chromium (from Core web/)');process.exitCode=1})"
    subprocess.run([str(node), "-e", browser_check, str(core / "web/node_modules/playwright-core")], check=True)
    environment = {**os.environ, "PATH": str(node.parent) + os.pathsep + os.environ["PATH"], "FRONTVIA_CORE_ROOT": str(core)}
    if args.ucp:
        subprocess.run([str(node), "--import", "tsx", "scripts/pap10-core-check.mjs", "--preflight"],
                       cwd=plugin, env=environment, check=True)
    # Always test freshly built local packages, not a previous manifest's bundles.
    for command in [["pnpm", "build"], ["pnpm", "pack:local"]]:
        subprocess.run(command, cwd=plugin, env=environment, check=True)
    subprocess.run([str(Path.home() / ".cargo/bin/cargo"), "build", "--manifest-path", str(core / "platform/Cargo.toml"), "--locked", "-p", "frontvia-platform", "--bin", "frontvia-platform"], env=environment, check=True)
    suite = "dsh-ucp" if args.ucp else "dsh"
    raise SystemExit(subprocess.call([sys.executable, str(core / "platform/tests/pap03/commerce.py"), "--suite", suite], cwd=core, env=environment))
