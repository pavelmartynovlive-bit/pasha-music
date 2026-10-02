#!/usr/bin/env bash
set -euo pipefail

readonly AUTHORIZED_KEYS="/root/.ssh/authorized_keys"

if [[ $EUID -ne 0 ]]; then
  echo "Run this key rotation as root" >&2
  exit 1
fi

if [[ ${OLD_ROOT_PUBLIC_KEY:-} != ssh-ed25519\ * ]] || [[ ${NEW_ROOT_PUBLIC_KEY:-} != ssh-ed25519\ * ]]; then
  echo "Both root access keys must be Ed25519 public keys" >&2
  exit 1
fi

install -d -m 0700 -o root -g root /root/.ssh
touch "$AUTHORIZED_KEYS"
chmod 0600 "$AUTHORIZED_KEYS"

read -r old_type old_body _ <<<"$OLD_ROOT_PUBLIC_KEY"
read -r new_type new_body _ <<<"$NEW_ROOT_PUBLIC_KEY"

if ! awk -v type="$new_type" -v body="$new_body" '$1 == type && $2 == body { found = 1 } END { exit !found }' "$AUTHORIZED_KEYS"; then
  printf '%s\n' "$NEW_ROOT_PUBLIC_KEY" >> "$AUTHORIZED_KEYS"
fi

temporary_file="$(mktemp /root/.ssh/authorized_keys.XXXXXX)"
awk -v type="$old_type" -v body="$old_body" '!($1 == type && $2 == body)' "$AUTHORIZED_KEYS" > "$temporary_file"
install -m 0600 -o root -g root "$temporary_file" "$AUTHORIZED_KEYS"
rm -f "$temporary_file"

if ! awk -v type="$new_type" -v body="$new_body" '$1 == type && $2 == body { found = 1 } END { exit !found }' "$AUTHORIZED_KEYS"; then
  echo "New root access key was not installed" >&2
  exit 1
fi

if awk -v type="$old_type" -v body="$old_body" '$1 == type && $2 == body { found = 1 } END { exit !found }' "$AUTHORIZED_KEYS"; then
  echo "Old root access key is still present" >&2
  exit 1
fi

echo "Root SSH access key rotated"
