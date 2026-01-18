#!/bin/bash
set -euo pipefail

# Robust entrypoint for mailsync build container
# Usage:
#  - (default) no args: runs "build"
#  - build: runs /workspace/mailsync/build.sh and prints artifact location
#  - shell: drops to interactive shell
#  - any other args are executed as a command

# If container started as root and HOST_UID is provided, map/create 'builder' user
if [ "$(id -u)" = "0" ] && [ -n "${HOST_UID:-}" ]; then
  HOST_GID="${HOST_GID:-$HOST_UID}"
  echo "Configuring 'builder' user to UID:GID ${HOST_UID}:${HOST_GID}"

  # create or reuse group with desired GID
  if getent group "$HOST_GID" >/dev/null 2>&1; then
    EXISTING_GROUP=$(getent group "$HOST_GID" | cut -d: -f1)
    echo "GID $HOST_GID already exists as group $EXISTING_GROUP; reusing"
    GROUP_NAME="$EXISTING_GROUP"
  else
    groupadd -g "$HOST_GID" builder || true
    GROUP_NAME=builder
  fi

  if id -u builder >/dev/null 2>&1; then
    usermod -u "$HOST_UID" -g "$GROUP_NAME" builder || true
  else
    useradd -u "$HOST_UID" -g "$GROUP_NAME" -m builder || true
    echo "builder ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/builder
  fi

  # Best-effort chown of workspace and home
  chown -R "$HOST_UID":"$HOST_GID" /home/builder || true
  chown -R "$HOST_UID":"$HOST_GID" /workspace || true
fi

# If no args provided, default to 'build'
if [ "$#" -eq 0 ]; then
  set -- build
fi

for cmd in "$@"; do
  case "$cmd" in
    clean)
      echo "cleaning vendored dependencies and stale installs..."

      echo "Cleaning Vendor/libetpan build artifacts and removing old installs..."
      cd /workspace/mailsync/Vendor/libetpan
      sudo make distclean >/dev/null 2>&1 || sudo make clean >/dev/null 2>&1 || true
      # Remove generated build directories (best-effort)
      rm -rf .libs autom4te.cache aclocal.m4 build-*/configure.tmp || true
      # Remove any previous system-installed libetpan copies that could be stale
      sudo rm -f /usr/lib/libetpan* /usr/local/lib/libetpan* || true

      echo "Cleaning Vendor/mailcore2 build directories..."
      cd /workspace/mailsync/Vendor/mailcore2
      rm -rf build || true

      # Remove top-level CMake artifacts from previous builds (safe to regenerate)
      cd /workspace/mailsync
      rm -rf CMakeFiles CMakeCache.txt build || true

      echo "Removing node_modules..."
      rm -rf /workspace/node_modules /workspace/app/node_modules || true

      echo "Removing built components..."
      rm -rf /workspace/app/*.so* || true
      rm -rf /workspace/app/mailsync /workspace/app/mailsync.bin || true
      rm -rf /workspace/mailsync/mailsync || true
      
      echo "Removing previous build artifacts..."
      rm -rf /workspace/app/dist || true

      echo "Returning to workspace root..."
      cd /workspace
      
      ;;
      
    build)
      echo "Running build as 'builder' (UID $(id -u builder))"
      sudo -E -H -u builder HOME=/home/builder PATH="$PATH" bash -lc "mailsync/build.sh && npm ci && npm run build"
      echo "Build finished. Artifacts:"
      echo " - mailsync binary: /workspace/mailsync/mailsync"
      echo " - frontend and packages: /workspace/app/dist"
      ;;
    build-mailsync)
      echo "Building mailsync binary..."
      sudo -E -H -u builder HOME=/home/builder PATH="$PATH" bash -lc "mailsync/build.sh"
      echo "Build finished. Artifact is at /workspace/mailsync/mailsync"
      ;;
    build-packages)
      echo "Building frontend and packages..."  
      sudo -E -H -u builder HOME=/home/builder PATH="$PATH" bash -lc "npm ci && npm run build"

      echo "Build finished. Artifacts are in /workspace/app/dist"
      ls -lh /workspace/app/dist || true
      ;;
      
    shell)
      exec /bin/bash
      ;;
      
    *)
      # Run arbitrary command (behave like original: exec and replace process)
      exec "$cmd"
      ;;
  esac
done

exit 0
