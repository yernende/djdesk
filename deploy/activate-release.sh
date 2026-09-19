#!/bin/bash
# Operator fallback. Install a compatible restricted receiver first.
set -euo pipefail
release=${1:?Usage: activate-release.sh RELEASE ARCHIVE SHA256}
archive=${2:?Archive path required}
expected=${3:?SHA-256 required}
[[ "$release" =~ ^djdesk-[0-9]{8}T[0-9]{6}Z(-[a-f0-9]{12})?$ ]] || exit 2
[[ "$expected" =~ ^[a-f0-9]{64}$ ]] || exit 2
[[ $(id -u) == 0 ]] || exit 1
exec runuser -u djdesk-deploy -- env SSH_ORIGINAL_COMMAND="deploy $release $expected" \
    /usr/local/lib/djdesk/receive-release.py < "$archive"
