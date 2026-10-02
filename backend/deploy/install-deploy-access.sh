#!/usr/bin/env bash
set -euo pipefail

readonly DEPLOY_USER="pasha-deploy"
readonly DEPLOY_HOME="/home/$DEPLOY_USER"
readonly DEPLOY_COMMAND="/usr/local/sbin/deploy-pasha-music"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Run this bootstrap as root" >&2
  exit 1
fi

if [[ ${DEPLOY_PUBLIC_KEY:-} != ssh-ed25519\ * ]]; then
  echo "DEPLOY_PUBLIC_KEY must contain an Ed25519 public key" >&2
  exit 1
fi

if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
fi

install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/.ssh"
printf '%s\n' "$DEPLOY_PUBLIC_KEY" > "$DEPLOY_HOME/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_HOME/.ssh/authorized_keys"
chmod 0600 "$DEPLOY_HOME/.ssh/authorized_keys"
install -d -m 0750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/incoming/backend"

install -m 0755 -o root -g root "$SCRIPT_DIR/deploy-backend.sh" "$DEPLOY_COMMAND"
printf '%s\n' "$DEPLOY_USER ALL=(root) NOPASSWD: $DEPLOY_COMMAND" > /etc/sudoers.d/pasha-music-deploy
chmod 0440 /etc/sudoers.d/pasha-music-deploy
visudo -cf /etc/sudoers.d/pasha-music-deploy >/dev/null

echo "Deployment access installed for $DEPLOY_USER"
