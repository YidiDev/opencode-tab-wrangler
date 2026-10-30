#!/usr/bin/env python3
"""Install only the reviewed Linux x64 host binary; verify registry SRI before extraction."""

import argparse
import base64
import hashlib
import io
import tarfile
import urllib.request
from pathlib import Path

HOSTS = {
    "2.1.4": "o8EJ0ZsT4dzDKN+0mpG2EKbNGzJyp+F1++Av28UReRVfiEv+N34eZEnN/unkiMoerKHad6W6Ii7k4ukTnPNmNQ==",
    "2.2.2": "wa0ol1HUaKNDTqjfqJwqmq3n4tlejBy2UT48wVRCypRUGy9WbIpXeL9xlHmljAodQD6HcZR2dqiJYFTlDMqIVA==",
}
parser = argparse.ArgumentParser()
parser.add_argument("--version", choices=HOSTS, default="2.1.4")
args = parser.parse_args()
URL = f"https://registry.npmjs.org/@opencode/cli-linux-x64/-/cli-linux-x64-{args.version}.tgz"
SHA512 = HOSTS[args.version]
repo = Path(__file__).resolve().parents[1]
with urllib.request.urlopen(URL, timeout=180) as response:
    content = response.read(150_000_001)
if (
    len(content) > 150_000_000
    or base64.b64encode(hashlib.sha512(content).digest()).decode() != SHA512
):
    raise SystemExit("Host download failed integrity or size verification")
with tarfile.open(fileobj=io.BytesIO(content), mode="r:gz") as archive:
    binaries = [
        m
        for m in archive.getmembers()
        if m.name in {"package/bin/opencode", "package/bin/opencode.exe"} and m.isfile()
    ]
    if len(binaries) != 1:
        raise SystemExit("Unexpected host archive layout")
    member = archive.extractfile(binaries[0])
    assert member is not None
    destination = (
        repo
        / ".artifacts"
        / ("host" if args.version == "2.1.4" else f"host-{args.version}")
        / "bin"
        / "opencode"
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(member.read())
    destination.chmod(0o755)
print(destination.parent)
