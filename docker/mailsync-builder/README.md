mailsync-builder
=================

Small helper image for building `mailsync` and `Mailspring-Sync` locally using an Ubuntu 22.04 environment that mirrors CI.

Build the image:

  docker build -t mailsync-builder docker/mailsync-builder

Run the build using your repository as a volume (the repo root is mounted to /workspace inside the container):

  docker run --rm -it -v "$(pwd)":/workspace -w /workspace mailsync-builder /usr/local/bin/mailsync-build

Notes:
- The container installs the system packages used by the `build-linux` GitHub Actions workflow and Node.js 20.
- The convenience script `mailsync-build` will run `./mailsync/build.sh` if present; otherwise it opens a shell.
- You can run the build as a non-root `builder` user inside the container; if you need to install extra packages inside the container, add them to the Dockerfile or run `sudo apt-get` from within.
