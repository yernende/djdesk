#!/usr/bin/env python3
"""Send one checked artifact over a host-pinned, restricted SSH connection."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request


def deployment_settings(env):
    target = env.get('DEPLOY_SSH_TARGET', '')
    match = re.fullmatch(r'[a-z_][a-z0-9_-]*@([a-zA-Z0-9][a-zA-Z0-9.-]*|\[[0-9a-fA-F:]+\])', target)
    if not match:
        raise ValueError('DEPLOY_SSH_TARGET must be user@host')
    origin = env.get('DEPLOY_PUBLIC_ORIGIN', '').rstrip('/')
    url = urllib.parse.urlsplit(origin)
    if (url.scheme != 'https' or not url.hostname or url.username or url.password
            or url.path or url.query or url.fragment):
        raise ValueError('DEPLOY_PUBLIC_ORIGIN must be an HTTPS origin')
    return target, match.group(1).strip('[]'), origin


def checked_metadata(root, source_commit):
    metadata = json.loads((root / 'release.json').read_text())
    if not re.fullmatch(r'djdesk-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}', metadata['release']):
        raise ValueError('Invalid release ID')
    if not re.fullmatch('[a-f0-9]{64}', metadata['sha256']):
        raise ValueError('Invalid digest')
    if metadata['source_commit'] != source_commit or metadata['source_dirty']:
        raise ValueError('Artifact does not match the clean workflow commit')
    return metadata


def main():
    target, hostname, origin = deployment_settings(os.environ)
    # SSH diagnostics may mention the host separately from the full masked secret.
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        print(f'::add-mask::{hostname}', flush=True)
    root = Path('artifacts/release')
    metadata = checked_metadata(root, os.environ['GITHUB_SHA'])
    release, digest = metadata['release'], metadata['sha256']

    with tempfile.TemporaryDirectory() as directory:
        key, hosts = Path(directory) / 'key', Path(directory) / 'known_hosts'
        key.write_text(os.environ.pop('DEPLOY_SSH_KEY') + '\n')
        key.chmod(0o600)
        hosts.write_text(os.environ.pop('DEPLOY_KNOWN_HOSTS') + '\n')
        hosts.chmod(0o600)
        with (root / (release + '.tgz')).open('rb') as archive:
            subprocess.run(['ssh', '-T', '-i', str(key), '-o', 'IdentitiesOnly=yes',
                            '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                            '-o', 'UserKnownHostsFile=' + str(hosts), '-o', 'ConnectTimeout=15',
                            '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4',
                            target, 'deploy ' + release + ' ' + digest],
                           stdin=archive, check=True, timeout=660)

    for attempt in range(12):
        try:
            with urllib.request.urlopen(origin + '/release.json', timeout=10) as response:
                deployed = json.load(response)
            if deployed['release'] == release and deployed['source_commit'] == os.environ['GITHUB_SHA']:
                break
        except (OSError, ValueError, KeyError):
            pass
        time.sleep(2)
    else:
        raise SystemExit('Public HTTPS endpoint did not report the expected release')
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
        summary.write(f'Deployed **{release}** from `{metadata["source_commit"]}`.\n\n'
                      f'[Open DJ Desk]({origin}). Persistent database and audio unchanged.\n')


if __name__ == '__main__':
    main()
