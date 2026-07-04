#!/usr/bin/env bash
# vk-hardening: read-only audit of a VK node.
# Single SSH session, every command timed-out, NO writes, NO restarts.
# Safe to run on a node that is currently processing inspection.
#
# Usage:
#   scripts/vk-hardening/audit-readonly.sh <node>
#   e.g. scripts/vk-hardening/audit-readonly.sh vk01
#
# Reads SSH credentials from config/vk-deployments/03002.json
# and ~/.secrets/vk-ssh-password.

set -uo pipefail

NODE="${1:-vk01}"
DEPLOYMENT="${2:-03002}"
CONFIG="${ORCHESTRATOR_HOME:-/home/teruel/JARVIS}/config/vk-deployments/${DEPLOYMENT}.json"
PW_FILE="${HOME}/.secrets/vk-ssh-password"

[ -r "$CONFIG" ] || { echo "Missing config: $CONFIG"; exit 1; }
[ -r "$PW_FILE" ] || { echo "Missing password file: $PW_FILE"; exit 1; }
command -v jq      >/dev/null || { echo "jq required";      exit 1; }
command -v sshpass >/dev/null || { echo "sshpass required"; exit 1; }

HOST=$(jq -r ".nodes.$NODE.host"     "$CONFIG")
USER=$(jq -r ".nodes.$NODE.user"     "$CONFIG")
PORT=$(jq -r ".nodes.$NODE.ssh_port" "$CONFIG")

[ "$HOST" = "null" ] && { echo "Node '$NODE' not in $CONFIG"; exit 1; }

TS=$(date -u +%Y-%m-%dT%H-%M-%SZ)
OUT_DIR="${ORCHESTRATOR_HOME:-/home/teruel/JARVIS}/reports/vk-hardening/raw"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/${DEPLOYMENT}-${NODE}-${TS}.txt"

echo "Auditing $NODE ($HOST:$PORT)  -> $OUT"

# Heredoc-quoted: variables and command substitutions evaluated on the remote.
sshpass -p "$(cat "$PW_FILE")" \
  ssh -o ConnectTimeout=15 -o StrictHostKeyChecking=no -p "$PORT" "${USER}@${HOST}" \
  'bash -s' <<'REMOTE' > "$OUT" 2>&1
set +e
T() { timeout 20 "$@" 2>&1; }
HR() { printf '\n=== SECTION: %s ===\n' "$1"; }

HR meta
date -u +%FT%TZ
hostname
uptime

HR boot_timeline
T systemd-analyze
echo "---"
T systemd-analyze blame | head -30
echo "---"
T systemd-analyze critical-chain

HR boot_history
T last -x reboot | head -10
echo "---"
T journalctl --list-boots | tail -10

HR kernel_severe_events
T journalctl -k -b 0 --no-pager | grep -iE \
  "panic|oops|hard lockup|soft lockup|WHEA|MCE|out of memory|nmi watchdog|general protection|bad page" \
  | head -40

HR crash_artifacts
ls -la /var/crash/   2>/dev/null
echo "---"
ls -la /sys/fs/pstore/ 2>/dev/null
echo "---"
T journalctl -k -b -1 --no-pager 2>/dev/null | tail -50

HR failed_units
T systemctl --failed --no-pager

HR flapping_units
for u in $(systemctl list-units --no-pager --no-legend --state=loaded 2>/dev/null | awk '{print $1}'); do
  nr=$(systemctl show -p NRestarts --value "$u" 2>/dev/null)
  [ -n "$nr" ] && [ "$nr" -gt 0 ] && printf '%5d  %s\n' "$nr" "$u"
done | sort -rn | head -15

HR enabled_units
T systemctl list-unit-files --state=enabled --no-pager | head -50

HR docker_runtime
T docker --version
T docker compose version
echo "---"
T docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' | head -40

HR docker_containers_health
for c in $(docker ps -q 2>/dev/null); do
  docker inspect --format '{{.Name}}|restart={{.HostConfig.RestartPolicy.Name}}|max={{.HostConfig.RestartPolicy.MaximumRetryCount}}|hc={{if .Config.Healthcheck}}{{.State.Health.Status}}{{else}}none{{end}}|restartCount={{.RestartCount}}' "$c" 2>/dev/null
done | column -t -s '|'

HR docker_compose_files
mapfile -t COMPOSE_FILES < <(find /home /opt /srv -maxdepth 6 -type f \( -name 'docker-compose*.y*ml' -o -name 'compose.y*ml' \) 2>/dev/null | head -10)
printf '%s\n' "${COMPOSE_FILES[@]}"
echo "---"
for f in "${COMPOSE_FILES[@]}"; do
  echo "===> $f"
  grep -nE '^[[:space:]]+(restart|healthcheck|depends_on|condition|start_period):' "$f" 2>/dev/null | head -40
done

HR docker_storage
T docker system df

HR udev_rules
ls -la /etc/udev/rules.d/ 2>/dev/null
echo "---"
grep -RHn -E "2bdf|MV-CS|hikrobot|by-path" /etc/udev/rules.d/ /lib/udev/rules.d/ 2>/dev/null | head -30

HR usb_topology
T lsusb
echo "---"
T lsusb -t

HR usb_cameras
for d in /sys/bus/usb/devices/*/idVendor; do
  v=$(cat "$d" 2>/dev/null)
  if [ "$v" = "2bdf" ]; then
    dev=$(dirname "$d")
    printf 'sysfs=%s  product=%s  serial=%s  speed=%sMb/s\n' \
      "$dev" "$(cat "$dev/product" 2>/dev/null)" "$(cat "$dev/serial" 2>/dev/null)" "$(cat "$dev/speed" 2>/dev/null)"
  fi
done

HR usb_autosuspend
echo "usbcore.autosuspend=$(cat /sys/module/usbcore/parameters/autosuspend 2>/dev/null)"
for d in /sys/bus/usb/devices/*/power/control; do
  printf '%-30s %s\n' "$(dirname "$d" | sed 's,/sys/bus/usb/devices/,,')" "$(cat "$d" 2>/dev/null)"
done | head -20

HR gpu
T nvidia-smi --query-gpu=name,persistence_mode,driver_version,vbios_version,power.draw,temperature.gpu,utilization.gpu --format=csv
echo "---"
systemctl status nvidia-persistenced --no-pager 2>&1 | head -5

HR storage
T df -hT
echo "---"
T lsblk -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT,UUID
echo "---"
cat /etc/fstab 2>/dev/null
echo "---"
T smartctl --scan 2>/dev/null

HR kernel_runtime
uname -a
cat /proc/cmdline
echo "---"
sysctl -a 2>/dev/null | grep -E \
  '^(vm\.swappiness|vm\.overcommit_memory|vm\.dirty_(background_)?ratio|kernel\.panic|kernel\.hung_task|kernel\.softlockup|fs\.file-max|net\.core\.rmem_max|net\.core\.wmem_max)' \
  | sort

HR time_sync
T timedatectl status
echo "---"
T chronyc tracking 2>/dev/null || systemctl status systemd-timesyncd --no-pager 2>&1 | head -10

HR journal
T journalctl --disk-usage
echo "---"
grep -vE '^\s*(#|$)' /etc/systemd/journald.conf 2>/dev/null

HR log_sizes
T find /var/log -size +200M -type f 2>/dev/null -printf '%s  %p\n' | sort -rn | head -10

HR kdump_watchdog
systemctl status kdump --no-pager 2>&1 | head -5
echo "---"
cat /sys/kernel/kexec_crash_loaded 2>/dev/null
echo "---"
grep -iE 'watchdog|RuntimeWatchdog' /etc/systemd/system.conf 2>/dev/null
echo "---"
ls -la /dev/watchdog* 2>/dev/null

HR unattended_upgrades
cat /etc/apt/apt.conf.d/20auto-upgrades 2>/dev/null
echo "---"
systemctl status unattended-upgrades --no-pager 2>&1 | head -5

HR firmware
echo bios-version=$(sudo -n dmidecode -s bios-version 2>/dev/null || echo unavailable)
echo bios-release-date=$(sudo -n dmidecode -s bios-release-date 2>/dev/null || echo unavailable)
echo processor-version=$(sudo -n dmidecode -s processor-version 2>/dev/null || echo unavailable)

HR cpu_microcode
grep microcode /proc/cpuinfo | uniq
echo "---"
journalctl -k -b 0 2>/dev/null | grep -i microcode | head -5

HR network
ip -br addr
echo "---"
ip -br link
echo "---"
ss -tnlp 2>/dev/null | head -30
echo "---"
ufw status 2>/dev/null || iptables -L -n 2>/dev/null | head -20

HR security_baseline
echo "Sudoers timestamp_timeout/NOPASSWD scan:"
grep -RHnE 'NOPASSWD|timestamp_timeout' /etc/sudoers /etc/sudoers.d/ 2>/dev/null
echo "---"
echo "SSH PasswordAuth/RootLogin:"
grep -iE '^(PasswordAuthentication|PermitRootLogin|UsePAM)' /etc/ssh/sshd_config 2>/dev/null

HR done
date -u +%FT%TZ
REMOTE

EC=$?
echo "Audit finished (exit=$EC). Output: $OUT"
echo "Size: $(wc -l < "$OUT") lines, $(du -h "$OUT" | cut -f1)"
