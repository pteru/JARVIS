#!/bin/bash
# VK Health Monitor — SSH helper library
# Sourced by other scripts. Requires config.sh to be sourced first (provides CONFIG_FILE).
# Requires: sshpass, jq, VK_SSH_PASSWORD env var.

set -euo pipefail

# ---------------------------------------------------------------------------
# Validate dependencies
# ---------------------------------------------------------------------------
if ! command -v sshpass &>/dev/null; then
    echo "ERROR: sshpass not installed. Run: sudo apt install sshpass" >&2
    exit 1
fi

if [[ -z "${VK_SSH_PASSWORD:-}" ]]; then
    echo "ERROR: VK_SSH_PASSWORD environment variable is not set" >&2
    exit 1
fi

if [[ -z "${CONFIG_FILE:-}" ]]; then
    echo "ERROR: CONFIG_FILE is not set. Source config.sh first." >&2
    exit 1
fi

export SSHPASS="$VK_SSH_PASSWORD"

# SSH options shared across all functions
_SSH_OPTS=(-o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -o LogLevel=ERROR)

# ---------------------------------------------------------------------------
# node_host <node_name>
# Reads the host IP address for a node from the deployment config.
# ---------------------------------------------------------------------------
node_host() {
    local node_name="$1"
    jq -r --arg n "$node_name" '.nodes[$n].host // empty' "$CONFIG_FILE"
}

# ---------------------------------------------------------------------------
# node_user <node_name>
# Reads the SSH username for a node from the deployment config.
# ---------------------------------------------------------------------------
node_user() {
    local node_name="$1"
    jq -r --arg n "$node_name" '.nodes[$n].user // empty' "$CONFIG_FILE"
}

# ---------------------------------------------------------------------------
# node_ssh_port <node_name>
# Reads the SSH port for a node from the deployment config.
# ---------------------------------------------------------------------------
node_ssh_port() {
    local node_name="$1"
    jq -r --arg n "$node_name" '.nodes[$n].ssh_port // 8050' "$CONFIG_FILE"
}

# ---------------------------------------------------------------------------
# ssh_cmd <node_name> <command>
# Runs a command on the remote node via sshpass + SSH. Returns the output.
# ---------------------------------------------------------------------------
ssh_cmd() {
    local node_name="$1"
    shift
    local host user port
    host=$(node_host "$node_name")
    user=$(node_user "$node_name")
    port=$(node_ssh_port "$node_name")

    if [[ -z "$host" || -z "$user" ]]; then
        echo "ERROR: Unknown node '$node_name'" >&2
        return 1
    fi

    sshpass -e ssh "${_SSH_OPTS[@]}" -p "$port" "${user}@${host}" "$@"
}

# ---------------------------------------------------------------------------
# ssh_script <node_name> <script_content>
# Pipes a bash script to the remote node via bash -s.
# ---------------------------------------------------------------------------
ssh_script() {
    local node_name="$1"
    local script_content="$2"
    local host user port
    host=$(node_host "$node_name")
    user=$(node_user "$node_name")
    port=$(node_ssh_port "$node_name")

    if [[ -z "$host" || -z "$user" ]]; then
        echo "ERROR: Unknown node '$node_name'" >&2
        return 1
    fi

    echo "$script_content" | sshpass -e ssh "${_SSH_OPTS[@]}" -p "$port" "${user}@${host}" "bash -s"
}

# ---------------------------------------------------------------------------
# scp_to <node_name> <local_path> <remote_path>
# Copies a local file to the remote node via sshpass + SCP.
# ---------------------------------------------------------------------------
scp_to() {
    local node_name="$1"
    local local_path="$2"
    local remote_path="$3"
    local host user port
    host=$(node_host "$node_name")
    user=$(node_user "$node_name")
    port=$(node_ssh_port "$node_name")

    if [[ -z "$host" || -z "$user" ]]; then
        echo "ERROR: Unknown node '$node_name'" >&2
        return 1
    fi

    sshpass -e scp "${_SSH_OPTS[@]}" -P "$port" "$local_path" "${user}@${host}:${remote_path}"
}

# ---------------------------------------------------------------------------
# is_node_reachable <node_name>
# Quick SSH connectivity test. Returns 0 if reachable, 1 otherwise.
# ---------------------------------------------------------------------------
is_node_reachable() {
    local node_name="$1"
    if ssh_cmd "$node_name" "echo ok" &>/dev/null; then
        return 0
    else
        return 1
    fi
}
