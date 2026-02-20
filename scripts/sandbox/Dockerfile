FROM ubuntu:24.04

# Avoid interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=America/Sao_Paulo

# System packages
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    jq \
    build-essential \
    python3 \
    python3-pip \
    python3-venv \
    ca-certificates \
    gnupg \
    openssh-client \
    sshpass \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user for sandbox work
RUN useradd -m -s /bin/bash sandbox \
    && echo "sandbox ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Working directories
RUN mkdir -p /repo-source /workspace /output /secrets \
    && chown -R sandbox:sandbox /workspace /output

# Copy entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER sandbox
WORKDIR /workspace

# Ensure output dir is writable regardless of volume mount
# (handled at runtime by entrypoint if volume mount overrides)
ENTRYPOINT ["/entrypoint.sh"]
