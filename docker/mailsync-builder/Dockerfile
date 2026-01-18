# mailsync-builder
# Lightweight builder image for Mailspring-Sync (matches .github/workflows/build-linux.yaml)

FROM ubuntu:22.04
LABEL maintainer="Mailspring <dev@foundry376.com>"
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies (kept in sync with build-linux.yaml)
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends \
    software-properties-common \
    autoconf automake build-essential clang cmake execstack fakeroot git \
    libc-ares-dev libctemplate-dev libcurl4-openssl-dev libglib2.0-dev \
    libicu-dev libsasl2-dev libsasl2-modules libsasl2-modules-gssapi-mit \
    libsecret-1-dev libssl-dev libnss3 libnss3-dev libtidy-dev libtool \
    libxext-dev libxkbfile-dev libxml2-dev libxtst-dev pkg-config rpm \
    uuid-dev xvfb curl ca-certificates sudo liblzma-dev libsqlite3-dev \
 && rm -rf /var/lib/apt/lists/*

# Install Node.js (v20 LTS used by CI)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get update -y \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# Non-root builder user
RUN useradd -m builder && echo "builder ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/builder

WORKDIR /workspace

# Entrypoint: convenience script to run mailsync build when mounted
COPY docker-entrypoint.sh /usr/local/bin/mailsync-build
RUN chmod +x /usr/local/bin/mailsync-build

# NOTE: keep the image running as root by default so the entrypoint can map
# the host UID/GID to the 'builder' user at container start (development convenience)
ENTRYPOINT ["/usr/local/bin/mailsync-build"]
CMD ["bash"]
