#!/usr/bin/env python3
"""Read only the deployed test OTP preset; never print credentials."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

REMOTE = '''import json
from dotenv import dotenv_values
v=dotenv_values("/etc/awiki/user-service.env")
keys=["DID_HOSTNAME","HANDLE_DOMAIN","AWIKI_PRODUCTION_TEST_OTP_ENABLED","DEV_OTP_PHONE","DEV_OTP_CODE"]
print(json.dumps({k:v.get(k,"") for k in keys}))
'''

if __name__ == "__main__":
    result = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "awiki", "sudo", "-n",
        "/opt/awiki/services/user-service/current/.venv/bin/python", "-"], input=REMOTE,
        text=True, capture_output=True, timeout=30)
    if result.returncode:
        raise SystemExit("Could not read the deployed awiki.me test preset; no configuration changed")
    value = json.loads(result.stdout)
    assert value["DID_HOSTNAME"] == value["HANDLE_DOMAIN"] == "awiki.me"
    assert value["AWIKI_PRODUCTION_TEST_OTP_ENABLED"].lower() in {"true", "1"}
    assert re.fullmatch(r"\+[1-9][0-9]{6,14}", value["DEV_OTP_PHONE"])
    assert re.fullmatch(r"[0-9]{6}", value["DEV_OTP_CODE"])
    directory = Path(__file__).resolve().parents[2] / ".local/identity/awiki-me"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    assert directory.stat().st_uid == os.getuid() and not directory.stat().st_mode & 0o077
    target = directory / "auth.json"
    assert not target.is_symlink()
    descriptor, temporary = tempfile.mkstemp(dir=directory, prefix=".auth-")
    try:
        with os.fdopen(descriptor, "w") as output:
            json.dump({"origin": "https://awiki.me", "phone": value["DEV_OTP_PHONE"], "code": value["DEV_OTP_CODE"]}, output)
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)
    print(json.dumps({"status": "configured", "origin": "https://awiki.me", "testPhoneConfigured": True,
        "testCodeConfigured": True, "serverConfigurationChanged": False}))
