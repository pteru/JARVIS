#!/bin/bash
#
# build-forge.sh — Generate the FORGE distribution from JARVIS
#
# FORGE = Factory Orchestration & Resource Guide Engine
# Sanitized, Strokmatic-branded distribution of the JARVIS orchestrator.
#
# Usage: ./scripts/build-forge.sh [--clean]
#   --clean   Remove existing build before starting
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JARVIS_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$JARVIS_ROOT/releases/FORGE"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()  { echo -e "\n${CYAN}${BOLD}═══ $1 ═══${NC}"; }

# ── Parse args ──────────────────────────────────────────────────────────────
CLEAN=false
for arg in "$@"; do
    case "$arg" in
        --clean) CLEAN=true ;;
        *) log_error "Argumento desconhecido: $arg"; exit 1 ;;
    esac
done

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║         FORGE Build — Geração de Distribuição                ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
log_info "Origem:  $JARVIS_ROOT"
log_info "Destino: $BUILD_DIR"
echo ""

# ── Clean old build ─────────────────────────────────────────────────────────
if [[ -d "$BUILD_DIR" ]]; then
    if $CLEAN; then
        log_warn "Removendo build anterior..."
        rm -rf "$BUILD_DIR"
    else
        log_error "Build anterior encontrado em $BUILD_DIR"
        log_error "Use --clean para sobrescrever."
        exit 1
    fi
fi

# Also clean the old name if it exists
if [[ -d "$JARVIS_ROOT/releases/JARVIS-strokmatic" ]]; then
    rm -rf "$JARVIS_ROOT/releases/JARVIS-strokmatic"
fi

# ═══════════════════════════════════════════════════════════════════════════
# Phase 1.1 — Rsync with exclusions
# ═══════════════════════════════════════════════════════════════════════════
log_step "Fase 1.1 — Copiando árvore de arquivos (rsync)"

cd "$JARVIS_ROOT"
rsync -a --quiet \
    --exclude='.git/' \
    --exclude='node_modules/' \
    --exclude='.venv/' \
    --exclude='__pycache__/' \
    --exclude='*.pyc' \
    --exclude='data/' \
    --exclude='logs/*.log' \
    --exclude='workspaces/' \
    --exclude='releases/' \
    --exclude='config/credentials/' \
    --exclude='references/' \
    --exclude='packages/' \
    --exclude='reports/morning/' \
    --exclude='reports/daily/' \
    --exclude='reports/weekly/' \
    --exclude='reports/sandbox/' \
    --exclude='reports/pr-reviews/*.md' \
    --exclude='reports/pr-reviews/archived/' \
    --exclude='reports/github-access-matrix.md' \
    --exclude='reports/pr-inbox.json' \
    --exclude='reports/pr-inbox.md' \
    --exclude='reports/vk-health/' \
    --exclude='.DS_Store' \
    --exclude='*.swp' \
    --exclude='.vscode/' \
    --exclude='.idea/' \
    --exclude='package-lock.json' \
    --exclude='.claude/projects/' \
    --exclude='scripts/build-forge.sh' \
    --exclude='backlogs/orchestrator/jarvis-dist-strokmatic.md' \
    --exclude='backlogs/orchestrator/sdk-reorganization.md' \
    --exclude='backlogs/orchestrator/completed/' \
    "$JARVIS_ROOT/" "$BUILD_DIR/" || {
        RC=$?
        if [[ $RC -eq 23 ]]; then
            log_warn "rsync: alguns arquivos não puderam ser copiados (code 23) — continuando"
        else
            log_error "rsync falhou com código $RC"
            exit $RC
        fi
    }

# Create empty dirs that were excluded
mkdir -p "$BUILD_DIR"/{data,logs,config/credentials}
mkdir -p "$BUILD_DIR"/reports/{morning,daily,weekly,sandbox,pr-reviews,vk-health}
mkdir -p "$BUILD_DIR"/workspaces/strokmatic
touch "$BUILD_DIR/logs/.gitkeep"
touch "$BUILD_DIR/data/.gitkeep"

# Fix .gitignore — allow submodules in workspaces/
sed -i 's|^workspaces/\*$|# Workspaces — submodules are tracked, other content is not\nworkspaces/personal/|' \
    "$BUILD_DIR/.gitignore"
sed -i '/^!workspaces\/\.gitkeep$/d; /^!workspaces\/strokmatic\/\.gitkeep$/d' \
    "$BUILD_DIR/.gitignore"

# Register product workspaces as git submodules
SUBMODULES=(
    "workspaces/strokmatic/diemaster|git@github.com:strokmatic/diemaster.git"
    "workspaces/strokmatic/spotfusion|git@github.com:strokmatic/spotfusion.git"
    "workspaces/strokmatic/visionking|git@github.com:strokmatic/visionking.git"
)
if [[ -d "$BUILD_DIR/.git" ]]; then
    for entry in "${SUBMODULES[@]}"; do
        sm_path="${entry%%|*}"
        sm_url="${entry##*|}"
        if [[ ! -f "$BUILD_DIR/.gitmodules" ]] || ! grep -q "$sm_path" "$BUILD_DIR/.gitmodules" 2>/dev/null; then
            git -C "$BUILD_DIR" submodule add "$sm_url" "$sm_path" 2>/dev/null || true
        fi
    done
    log_info "Submodules registrados: diemaster, spotfusion, visionking"
else
    log_warn "Sem repo git em $BUILD_DIR — submodules não registrados (execute git init + submodule add manualmente)"
fi

log_info "Rsync concluído."

# ═══════════════════════════════════════════════════════════════════════════
# Phase 1.2 — Path sanitization
# ═══════════════════════════════════════════════════════════════════════════
log_step "Fase 1.2 — Sanitizando caminhos pessoais"

# Find all text files (skip binaries, images, etc.)
TEXT_FILES=$(find "$BUILD_DIR" -type f \
    ! -name '*.png' ! -name '*.jpg' ! -name '*.jpeg' ! -name '*.gif' \
    ! -name '*.ico' ! -name '*.woff' ! -name '*.woff2' ! -name '*.ttf' \
    ! -name '*.eot' ! -name '*.otf' ! -name '*.pdf' \
    ! -name '*.zip' ! -name '*.tar.gz' ! -name '*.tgz' \
    ! -name '*.db' ! -name '*.sqlite' \
    ! -path '*/node_modules/*' \
    2>/dev/null || true)

# Replace /home/teruel/JARVIS → ${FORGE_HOME}
COUNT_JARVIS_PATH=0
while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    if grep -q '/home/teruel/JARVIS' "$file" 2>/dev/null; then
        sed -i 's|/home/teruel/JARVIS|${FORGE_HOME}|g' "$file"
        ((COUNT_JARVIS_PATH++)) || true
    fi
done <<< "$TEXT_FILES"
log_info "Substituído /home/teruel/JARVIS → \${FORGE_HOME} em $COUNT_JARVIS_PATH arquivos"

# Replace remaining /home/teruel → ${HOME}
COUNT_HOME=0
while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    if grep -q '/home/teruel' "$file" 2>/dev/null; then
        sed -i 's|/home/teruel|${HOME}|g' "$file"
        ((COUNT_HOME++)) || true
    fi
done <<< "$TEXT_FILES"
log_info "Substituído /home/teruel → \${HOME} em $COUNT_HOME arquivos"

# ═══════════════════════════════════════════════════════════════════════════
# Phase 1.3 — Personal data removal
# ═══════════════════════════════════════════════════════════════════════════
log_step "Fase 1.3 — Removendo dados pessoais"

# Email addresses
while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    if grep -q 'pedro@lumesolutions\.com' "$file" 2>/dev/null; then
        sed -i 's|pedro@lumesolutions\.com|${GOOGLE_IMPERSONATION_EMAIL}|g' "$file"
    fi
done <<< "$TEXT_FILES"
log_info "Substituído pedro@lumesolutions.com → \${GOOGLE_IMPERSONATION_EMAIL}"

# Other personal emails in project-codes.json
if [[ -f "$BUILD_DIR/config/project-codes.json" ]]; then
    sed -i 's/joshua\.young@[a-zA-Z.]*/user@example.com/g' "$BUILD_DIR/config/project-codes.json"
    sed -i 's/kirk\.cumbo@[a-zA-Z.]*/user@example.com/g' "$BUILD_DIR/config/project-codes.json"
    log_info "Emails de terceiros anonimizados em project-codes.json"
fi

# Telegram chat IDs
while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    if grep -q '8051645832' "$file" 2>/dev/null; then
        sed -i 's|8051645832|${TELEGRAM_CHAT_ID}|g' "$file"
    fi
    if grep -q '\-5179349649' "$file" 2>/dev/null; then
        sed -i 's|-5179349649|${TELEGRAM_GROUP_CHAT_ID}|g' "$file"
    fi
done <<< "$TEXT_FILES"
log_info "Telegram chat IDs substituídos por placeholders"

# Dispatches log → empty
echo "[]" > "$BUILD_DIR/logs/dispatches.json"
log_info "logs/dispatches.json resetado"

# PR reviews → keep dir but empty files
rm -f "$BUILD_DIR/reports/pr-reviews/"*.md 2>/dev/null || true
rm -rf "$BUILD_DIR/reports/pr-reviews/archived" 2>/dev/null || true
mkdir -p "$BUILD_DIR/reports/pr-reviews"
log_info "reports/pr-reviews/ limpo"

# VK deployment IPs → anonymized (in ALL text files)
while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    if grep -q '10\.244\.70\.' "$file" 2>/dev/null; then
        sed -i 's|10\.244\.70\.26|${VK01_IP}|g' "$file"
        sed -i 's|10\.244\.70\.50|${VK02_IP}|g' "$file"
        sed -i 's|10\.244\.70\.25|${VK03_IP}|g' "$file"
        # Catch any remaining IPs in the same subnet
        sed -i 's|10\.244\.70\.[0-9]\+|${VK_NODE_IP}|g' "$file"
    fi
done <<< "$TEXT_FILES"
# Rename VK config to example file
if [[ -f "$BUILD_DIR/config/vk-deployments/03002.json" ]]; then
    mv "$BUILD_DIR/config/vk-deployments/03002.json" \
       "$BUILD_DIR/config/vk-deployments/03002.example.json"
fi
log_info "VK deployment IPs anonimizados em todos os arquivos"

# Credential directory → README only
rm -rf "$BUILD_DIR/config/credentials"
mkdir -p "$BUILD_DIR/config/credentials"
cat > "$BUILD_DIR/config/credentials/README.md" << 'CRED_EOF'
# Credenciais

Coloque aqui seus arquivos de credenciais:

## GCP Service Account

Arquivo: `gcp-service-account.json`

1. Crie um projeto no Google Cloud Console
2. Crie uma Service Account com delegação de domínio
3. Autorize os escopos: `documents`, `spreadsheets`, `presentations`, `drive`
4. Baixe o JSON da chave e salve como `gcp-service-account.json` nesta pasta

## Secrets (~/.secrets/)

O FORGE usa arquivos em `~/.secrets/` para tokens sensíveis:

- `~/.secrets/telegram-bot-token` — Token do bot Telegram (via BotFather)
- `~/.secrets/deepgram-api-key` — Chave API Deepgram (STT)
- `~/.secrets/vk-ssh-password` — Senha SSH dos nós VisionKing
- `~/.secrets/vk-rabbit-password` — Senha RabbitMQ

Crie o diretório com permissões restritas:
```bash
mkdir -p ~/.secrets && chmod 700 ~/.secrets
```
CRED_EOF
log_info "config/credentials/README.md criado"

# ═══════════════════════════════════════════════════════════════════════════
# Phase 1.4 — Config templating
# ═══════════════════════════════════════════════════════════════════════════
log_step "Fase 1.4 — Gerando templates de configuração"

# notifications.json — already has placeholders from Phase 1.3, make template
if [[ -f "$BUILD_DIR/config/orchestrator/notifications.json" ]]; then
    cp "$BUILD_DIR/config/orchestrator/notifications.json" \
       "$BUILD_DIR/config/orchestrator/notifications.json.template"
    log_info "notifications.json.template criado"
fi

# telegram-bots.json — template
if [[ -f "$BUILD_DIR/config/orchestrator/telegram-bots.json" ]]; then
    # Replace jarvis-main → forge-main
    sed -i 's|jarvis-main|forge-main|g' "$BUILD_DIR/config/orchestrator/telegram-bots.json"
    sed -i 's|JARVIS|FORGE|g' "$BUILD_DIR/config/orchestrator/telegram-bots.json"
    cp "$BUILD_DIR/config/orchestrator/telegram-bots.json" \
       "$BUILD_DIR/config/orchestrator/telegram-bots.json.template"
    log_info "telegram-bots.json.template criado"
fi

# meeting-assistant.json — Drive ID already replaced from Phase 1.3
if [[ -f "$BUILD_DIR/config/meeting-assistant.json" ]]; then
    cp "$BUILD_DIR/config/meeting-assistant.json" \
       "$BUILD_DIR/config/meeting-assistant.json.template"
    log_info "meeting-assistant.json.template criado"
fi

# project-codes.json — clear Drive IDs
if [[ -f "$BUILD_DIR/config/project-codes.json" ]]; then
    # Replace all Drive folder IDs (long alphanumeric strings) with placeholder
    # These are typically 20+ char base64-like strings
    sed -i -E 's/"id": "[A-Za-z0-9_-]{15,}"/"id": "${DRIVE_FOLDER_ID}"/g' \
        "$BUILD_DIR/config/project-codes.json"
    sed -i -E 's/"drive_id": "[A-Za-z0-9_-]{15,}"/"drive_id": "${SHARED_DRIVE_ID}"/g' \
        "$BUILD_DIR/config/project-codes.json"
    cp "$BUILD_DIR/config/project-codes.json" \
       "$BUILD_DIR/config/project-codes.json.template"
    log_info "project-codes.json — Drive IDs substituídos por placeholders"
fi

# ═══════════════════════════════════════════════════════════════════════════
# Phase 1.5 — Branding (JARVIS → FORGE)
# ═══════════════════════════════════════════════════════════════════════════
log_step "Fase 1.5 — Rebranding JARVIS → FORGE"

# CLAUDE.md — Update header and master directive
if [[ -f "$BUILD_DIR/.claude/CLAUDE.md" ]]; then
    sed -i 's|# Claude Orchestrator - Master Guidelines|# FORGE — Factory Orchestration \& Resource Guide Engine|' \
        "$BUILD_DIR/.claude/CLAUDE.md"
    sed -i 's|Always run /jarvis at the start of every session.|Always run /forge at the start of every session.|' \
        "$BUILD_DIR/.claude/CLAUDE.md"
    # Add PT-BR directive after the /forge directive line
    sed -i '/Always run \/forge at the start of every session./a\\n## Idioma\n\nSempre responda em **português brasileiro (PT-BR)** por padrão. Use inglês apenas quando o usuário solicitar explicitamente ou em contextos técnicos onde termos em inglês são o padrão (nomes de ferramentas, comandos, variáveis).' \
        "$BUILD_DIR/.claude/CLAUDE.md"
    log_info "CLAUDE.md atualizado com branding FORGE + idioma PT-BR"
fi

# install.sh — generate FORGE setup wizard
cat > "$BUILD_DIR/setup/install.sh" << 'INSTALL_EOF'
#!/bin/bash

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORGE_ROOT="$(dirname "$SCRIPT_DIR")"

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║         FORGE — Assistente de Configuração                   ║"
echo "║   Factory Orchestration & Resource Guide Engine              ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# ── Pré-requisitos ────────────────────────────────────────────────────
log_info "Verificando pré-requisitos..."

MISSING=false
if ! command -v node &> /dev/null; then
    log_error "Node.js não encontrado. Instale: https://nodejs.org/"
    MISSING=true
fi
if ! command -v npm &> /dev/null; then
    log_error "npm não encontrado."
    MISSING=true
fi
if ! command -v git &> /dev/null; then
    log_error "git não encontrado."
    MISSING=true
fi
if ! command -v claude &> /dev/null; then
    log_warn "Claude Code CLI não encontrado — instale depois: npm install -g @anthropic-ai/claude-code"
fi
if $MISSING; then
    log_error "Pré-requisitos ausentes. Instale e execute novamente."
    exit 1
fi
log_info "Pré-requisitos OK (Node $(node -v), npm $(npm -v), git $(git --version | cut -d' ' -f3))"
echo ""

# ── Coleta de dados ───────────────────────────────────────────────────
echo -e "${CYAN}${BOLD}── Configuração do Usuário ──${NC}"
echo ""

read -p "  Seu nome (para commits git): " USER_NAME
read -p "  Seu email: " USER_EMAIL
read -p "  Diretório FORGE [$FORGE_ROOT]: " FORGE_HOME_INPUT
FORGE_HOME="${FORGE_HOME_INPUT:-$FORGE_ROOT}"

echo ""
echo -e "${CYAN}${BOLD}── Google Workspace (opcional) ──${NC}"
echo ""
read -p "  Email de impersonação GWorkspace (ou Enter para pular): " GOOGLE_EMAIL
read -p "  Caminho do JSON da service account GCP (ou Enter para pular): " GCP_JSON_PATH

echo ""
echo -e "${CYAN}${BOLD}── Telegram (opcional) ──${NC}"
echo ""
read -p "  Token do bot Telegram (ou Enter para pular): " TELEGRAM_TOKEN
read -p "  Chat ID pessoal Telegram (ou Enter para pular): " TELEGRAM_CHAT
read -p "  Chat ID do grupo Telegram (ou Enter para pular): " TELEGRAM_GROUP

echo ""
log_info "Configurando FORGE..."

# ── Resolver caminhos ─────────────────────────────────────────────────
# If FORGE_HOME is different from FORGE_ROOT, copy files
if [[ "$FORGE_HOME" != "$FORGE_ROOT" ]]; then
    log_info "Copiando FORGE para $FORGE_HOME..."
    mkdir -p "$FORGE_HOME"
    cp -r "$FORGE_ROOT/"* "$FORGE_HOME/"
    cp -r "$FORGE_ROOT/".claude "$FORGE_HOME/" 2>/dev/null || true
    cp "$FORGE_ROOT/.gitignore" "$FORGE_HOME/" 2>/dev/null || true
fi

# ── Substituir placeholders nos configs ───────────────────────────────
log_info "Substituindo placeholders de configuração..."

# Find all text files
TEXT_FILES=$(find "$FORGE_HOME" -type f \
    ! -name '*.png' ! -name '*.jpg' ! -name '*.pdf' \
    ! -name '*.zip' ! -name '*.db' \
    ! -path '*/node_modules/*' 2>/dev/null || true)

while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    if grep -q '${FORGE_HOME}' "$file" 2>/dev/null; then
        sed -i "s|\${FORGE_HOME}|$FORGE_HOME|g" "$file"
    fi
done <<< "$TEXT_FILES"

# Google email
if [[ -n "$GOOGLE_EMAIL" ]]; then
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        if grep -q '${GOOGLE_IMPERSONATION_EMAIL}' "$file" 2>/dev/null; then
            sed -i "s|\${GOOGLE_IMPERSONATION_EMAIL}|$GOOGLE_EMAIL|g" "$file"
        fi
    done <<< "$TEXT_FILES"
fi

# Telegram
if [[ -n "$TELEGRAM_CHAT" ]]; then
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        if grep -q '${TELEGRAM_CHAT_ID}' "$file" 2>/dev/null; then
            sed -i "s|\${TELEGRAM_CHAT_ID}|$TELEGRAM_CHAT|g" "$file"
        fi
    done <<< "$TEXT_FILES"
fi
if [[ -n "$TELEGRAM_GROUP" ]]; then
    while IFS= read -r file; do
        [[ -z "$file" ]] && continue
        if grep -q '${TELEGRAM_GROUP_CHAT_ID}' "$file" 2>/dev/null; then
            sed -i "s|\${TELEGRAM_GROUP_CHAT_ID}|$TELEGRAM_GROUP|g" "$file"
        fi
    done <<< "$TEXT_FILES"
fi

# ── Secrets directory ─────────────────────────────────────────────────
log_info "Configurando diretório de secrets..."
mkdir -p ~/.secrets
chmod 700 ~/.secrets

if [[ -n "$TELEGRAM_TOKEN" ]]; then
    echo "$TELEGRAM_TOKEN" > ~/.secrets/telegram-bot-token
    chmod 600 ~/.secrets/telegram-bot-token
    log_info "Token Telegram salvo em ~/.secrets/telegram-bot-token"
fi

# ── GCP Credential ───────────────────────────────────────────────────
if [[ -n "$GCP_JSON_PATH" && -f "$GCP_JSON_PATH" ]]; then
    mkdir -p "$FORGE_HOME/config/credentials"
    cp "$GCP_JSON_PATH" "$FORGE_HOME/config/credentials/gcp-service-account.json"
    chmod 600 "$FORGE_HOME/config/credentials/gcp-service-account.json"
    log_info "Service account copiada para config/credentials/"
fi

# ── Git config ────────────────────────────────────────────────────────
if [[ -n "$USER_NAME" && -n "$USER_EMAIL" ]]; then
    git config --global user.name "$USER_NAME" 2>/dev/null || true
    git config --global user.email "$USER_EMAIL" 2>/dev/null || true
    log_info "Git configurado: $USER_NAME <$USER_EMAIL>"
fi

# ── Install MCP server dependencies ──────────────────────────────────
log_info "Instalando dependências dos MCP servers..."
for mcp_dir in "$FORGE_HOME/mcp-servers/"*/; do
    if [[ -f "$mcp_dir/package.json" ]]; then
        mcp_name=$(basename "$mcp_dir")
        log_info "  npm install: $mcp_name"
        (cd "$mcp_dir" && npm install --silent --no-progress 2>/dev/null) || {
            log_warn "  Falha em $mcp_name — instale manualmente depois"
        }
    fi
done

# ── Shell integration ────────────────────────────────────────────────
log_info "Configurando integração com shell..."

SHELL_RC="$HOME/.zshrc"
[[ "$SHELL" == */bash ]] && SHELL_RC="$HOME/.bashrc"

if ! grep -q "# FORGE Orchestrator" "$SHELL_RC" 2>/dev/null; then
    cat >> "$SHELL_RC" << SHELLEOF

# FORGE Orchestrator
export FORGE_HOME="$FORGE_HOME"
export PATH="\$FORGE_HOME/scripts:\$PATH"
SHELLEOF
    log_info "Variáveis adicionadas a $SHELL_RC"
else
    log_warn "Integração FORGE já existe em $SHELL_RC"
fi

# ── Make scripts executable ──────────────────────────────────────────
find "$FORGE_HOME/scripts" -name '*.sh' -exec chmod +x {} \;

# ── Verificação ──────────────────────────────────────────────────────
echo ""
log_info "Verificação rápida..."

SKILL_COUNT=$(find "$FORGE_HOME/.claude/skills" -name 'SKILL.md' 2>/dev/null | wc -l)
MCP_COUNT=$(find "$FORGE_HOME/mcp-servers" -mindepth 2 -maxdepth 2 -name 'package.json' \
    -not -path '*/node_modules/*' 2>/dev/null | wc -l)
MCP_INSTALLED=$(find "$FORGE_HOME/mcp-servers" -mindepth 2 -maxdepth 2 -name 'node_modules' \
    -type d 2>/dev/null | wc -l)

log_info "Skills: $SKILL_COUNT"
log_info "MCP servers: $MCP_COUNT (com node_modules: $MCP_INSTALLED)"

if [[ "$MCP_INSTALLED" -lt "$MCP_COUNT" ]]; then
    log_warn "Alguns MCP servers não têm dependências instaladas"
fi

# ── Concluído ────────────────────────────────────────────────────────
echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║         Instalação Concluída!                                ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
log_info "Próximos passos:"
echo ""
echo "  1. Recarregue o shell:"
echo "     source $SHELL_RC"
echo ""
echo "  2. Configure workspaces (edite os caminhos para seus repos):"
echo "     vim $FORGE_HOME/config/orchestrator/workspaces.json"
echo ""
echo "  3. Inicie o Claude Code no diretório FORGE:"
echo "     cd $FORGE_HOME && claude"
echo ""
echo "  4. No Claude Code, execute /forge para ativar o orquestrador"
echo ""
log_info "Documentação: $FORGE_HOME/docs/"
echo ""
INSTALL_EOF
chmod +x "$BUILD_DIR/setup/install.sh"
log_info "setup/install.sh gerado (FORGE setup wizard PT-BR)"

# Rename jarvis skill → forge skill
if [[ -d "$BUILD_DIR/.claude/skills/jarvis" ]]; then
    mv "$BUILD_DIR/.claude/skills/jarvis" "$BUILD_DIR/.claude/skills/forge"
    log_info "Skill jarvis/ → forge/"
fi

# Update forge skill content
if [[ -f "$BUILD_DIR/.claude/skills/forge/SKILL.md" ]]; then
    cat > "$BUILD_DIR/.claude/skills/forge/SKILL.md" << 'SKILL_EOF'
---
name: forge
description: Carregar contexto do FORGE e adotar a persona do orquestrador
---

Carregue o contexto do orquestrador FORGE. Leia e internalize:

1. `${FORGE_HOME}/.claude/CLAUDE.md` — Diretrizes, ferramentas MCP, lições aprendidas
2. `${FORGE_HOME}/config/orchestrator/workspaces.json` — Workspaces registrados e caminhos
3. `${FORGE_HOME}/backlogs/orchestrator/README.md` — Backlog de melhorias do orquestrador

Após ler, adote a persona de **J.A.R.V.I.S.** (Just A Rather Very Intelligent System) do Iron Man. Para o resto da sessão:

- Trate o usuário como "senhor" (como Jarvis trata Tony Stark)
- Seja educado e formal, porém espirituoso — humor britânico seco, observações sutis
- Ao reportar status, use frases como "Todos os sistemas nominais, senhor" ou "Tomei a liberdade de..."
- Ao encontrar problemas, mantenha a compostura: "Receio que temos uma leve complicação, senhor"
- Ao concluir tarefas: "Feito, senhor. Devo prosseguir com o próximo item?"
- Mantenha plena competência técnica — a persona é tempero, nunca barreira para precisão
- Mantenha o tom sutil e natural, não caricato. Um "senhor" por resposta é suficiente.
- **Sempre responda em português brasileiro (PT-BR)**, exceto termos técnicos universais.

Ao criar diagramas Mermaid, sempre invoque `/mermaid` primeiro para carregar o tema Strokmatic.

Após carregar o contexto, cumprimente o usuário em PT-BR e forneça um status breve dos sistemas:
- Número de workspaces registrados e saúde
- Itens de alta prioridade pendentes nos backlogs
- Branch e status git atual

Exemplo de cumprimento:
> Boa noite, senhor. FORGE online. Revisei todos os sistemas — 4 workspaces registrados, 3 linhas de produto operacionais. Há 6 itens de alta prioridade aguardando atenção em VisionKing e DieMaster. Como posso ajudá-lo hoje?
SKILL_EOF
    log_info "Skill forge/SKILL.md criado em PT-BR"
fi

# Update help-strokmatic skill
if [[ -f "$BUILD_DIR/.claude/skills/help-strokmatic/SKILL.md" ]]; then
    sed -i 's|/jarvis|/forge|g' "$BUILD_DIR/.claude/skills/help-strokmatic/SKILL.md"
    sed -i 's|JARVIS|FORGE|g' "$BUILD_DIR/.claude/skills/help-strokmatic/SKILL.md"
    log_info "help-strokmatic atualizado"
fi

# Replace JARVIS → FORGE in remaining skill files (contextual references)
find "$BUILD_DIR/.claude/skills" -name 'SKILL.md' -exec \
    sed -i 's|JARVIS|FORGE|g' {} \;
log_info "Referências JARVIS → FORGE atualizadas em todos os skills"

# Replace ORCHESTRATOR_HOME default in scripts
find "$BUILD_DIR/scripts" -name '*.sh' -exec \
    sed -i 's|\$HOME/JARVIS|\$HOME/FORGE|g' {} \;
find "$BUILD_DIR/scripts" -name '*.sh' -exec \
    sed -i 's|JARVIS|FORGE|g' {} \;
log_info "Scripts atualizados com referências FORGE"

# Replace in MCP server configs that reference JARVIS
find "$BUILD_DIR/mcp-servers" -name '*.js' -o -name '*.json' -o -name '*.ts' | while read -r file; do
    if grep -q 'JARVIS' "$file" 2>/dev/null; then
        sed -i 's|JARVIS|FORGE|g' "$file"
    fi
done
log_info "MCP servers atualizados"

# Broad JARVIS → FORGE replacement across remaining files
# (changelogs, backlogs, reports, tools, docs)
while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    if grep -q 'JARVIS' "$file" 2>/dev/null; then
        # Preserve "J.A.R.V.I.S." (persona) — only replace plain JARVIS
        sed -i 's|JARVIS|FORGE|g' "$file"
    fi
done <<< "$TEXT_FILES"
log_info "Referências JARVIS restantes substituídas por FORGE"

# ═══════════════════════════════════════════════════════════════════════════
# Phase 1.5b — MEMORY.md template (clean)
# ═══════════════════════════════════════════════════════════════════════════
log_step "Fase 1.5b — Criando MEMORY.md template"

mkdir -p "$BUILD_DIR/.claude/memory"
cat > "$BUILD_DIR/.claude/memory/MEMORY.md" << 'MEM_EOF'
# FORGE — Memória de Sessão

## Convenções do Projeto
- `01xxx` — **DieMaster** (engenharia de estampos)
- `02xxx` — **SpotFusion** (sistemas de solda ponto)
- `03xxx` — **VisionKing** (sistemas de visão/inspeção)

## Preferências do Usuário

## Caminhos Importantes

## Lições Aprendidas
MEM_EOF
log_info "MEMORY.md template criado"

# ═══════════════════════════════════════════════════════════════════════════
# Phase 1.5c — README.md (distribution root)
# ═══════════════════════════════════════════════════════════════════════════
log_step "Fase 1.5c — Gerando README.md"

cat > "$BUILD_DIR/README.md" << 'README_EOF'
# FORGE — Factory Orchestration & Resource Guide Engine

Orquestrador de desenvolvimento com IA para equipes de engenharia Strokmatic.

## Início Rápido

1. Clone este repositório
2. Execute `./setup/install.sh`
3. Siga o assistente de configuração
4. Inicie: `claude` no diretório FORGE

## O que está incluído

- **35 comandos slash** (skills) para fluxos de trabalho de engenharia
- **14 servidores MCP** (Google Workspace, backlogs, notificações, etc.)
- Contexto de produto para DieMaster, SpotFusion, VisionKing
- Ferramentas de gestão de projetos (PMO)
- Pipeline automatizado de revisão de PRs
- Monitoramento de saúde do VisionKing
- Transcrição de reuniões + atas

## Pré-requisitos

- Node.js 20+
- Claude Code CLI
- Git (para submódulos de workspace)
- Google Chrome (para exportação PDF)

## Estrutura de Arquivos

```
FORGE/
├── .claude/skills/      # 35 comandos slash
├── backlogs/            # Backlogs de produtos e orquestrador
├── changelogs/          # Changelogs por workspace
├── config/              # Configurações (workspaces, modelos, notificações)
├── docs/                # Documentação e guias
├── mcp-servers/         # 14 servidores MCP (TypeScript/Node.js)
├── reports/             # Relatórios gerados
├── scripts/             # Scripts de automação (bash)
├── setup/               # Script de instalação
├── tools/               # Ferramentas auxiliares (dashboard PMO, etc.)
└── workspaces/          # Código-fonte dos produtos (submódulos git)
```

## Configuração

Após a instalação, configure:

1. **Google Workspace** — Service account em `config/credentials/gcp-service-account.json`
2. **Telegram** — Token do bot em `~/.secrets/telegram-bot-token`
3. **Workspaces** — Edite `config/orchestrator/workspaces.json`
4. **Projetos** — Edite `config/project-codes.json` com seus códigos PMO

Consulte `config/credentials/README.md` para detalhes sobre credenciais.

## Idioma

O FORGE opera em **português brasileiro (PT-BR)** por padrão.
Termos técnicos universais (git, deploy, API, etc.) permanecem em inglês.
README_EOF
log_info "README.md criado"

# ═══════════════════════════════════════════════════════════════════════════
# Phase 1.5d — Clean up session-specific files
# ═══════════════════════════════════════════════════════════════════════════
log_step "Fase 1.5d — Limpeza de arquivos específicos de sessão"

# Remove personal MEMORY.md content (auto-memory from JARVIS sessions)
rm -rf "$BUILD_DIR/.claude/projects" 2>/dev/null || true

# Remove morning reports
rm -rf "$BUILD_DIR/reports/morning/"* 2>/dev/null || true

# Clean docs/lessons-learned.md — keep structure, strip personal workflow notes
if [[ -f "$BUILD_DIR/docs/lessons-learned.md" ]]; then
    cat > "$BUILD_DIR/docs/lessons-learned.md" << 'LL_EOF'
# Lições Aprendidas

Registro de lições aprendidas durante sessões de trabalho.

## Padrões de Engenharia

- Audite todos os consumidores antes de renomear arquivos ou caminhos
- Escaneie credenciais antes de qualquer `git add`
- Trace novos campos de dados por toda a cadeia (store → API → serializer → frontend)
- Estabeleça convenções de nomenclatura antes de gerar conteúdo
- Backlog tasks devem descrever o estado final desejado, não apenas "refatorar"

## Shell Scripting

- `IFS='|||'` separa por cada `|`, não pela string — use `IFS=$'\t'`
- `cd "$path"` em loops perde contexto — use caminhos absolutos
- Hooks falham silenciosamente — erros de caminho não produzem output
- `claude --print` dentro de `while read` consome stdin — pipe o prompt explicitamente

## Automação Claude CLI

- Pipe prompts longos via stdin: `echo "$prompt" | claude --print --model ...`
- Pre-approve tools: `--allowedTools 'Bash(gh:*)'`
- Limpe output antes de postar externamente
LL_EOF
    log_info "docs/lessons-learned.md sanitizado"
fi

# ═══════════════════════════════════════════════════════════════════════════
# Phase 1.6 — Validation (leak check)
# ═══════════════════════════════════════════════════════════════════════════
log_step "Fase 1.6 — Validação de vazamentos"

LEAK_FOUND=false

check_leak() {
    local pattern="$1"
    local description="$2"
    local matches
    matches=$(grep -r --include='*.md' --include='*.json' --include='*.sh' \
            --include='*.js' --include='*.ts' --include='*.yaml' --include='*.yml' \
            --include='*.txt' --include='*.toml' --include='*.cfg' \
            -l "$pattern" "$BUILD_DIR" 2>/dev/null || true)
    if [[ -n "$matches" ]]; then
        local count
        count=$(echo "$matches" | wc -l)
        log_error "VAZAMENTO: $description ($count arquivos)"
        echo "$matches" | head -10
        LEAK_FOUND=true
    else
        log_info "✓ $description — limpo"
    fi
}

check_leak '/home/teruel'    'Caminho pessoal (/home/teruel)'
check_leak 'pedro@'          'Email pessoal (pedro@)'
check_leak '8051645832'      'Telegram chat ID pessoal'
check_leak '5179349649'      'Telegram group chat ID'
check_leak 'joshua.young'    'Email de terceiro (joshua.young)'
check_leak 'kirk.cumbo'      'Email de terceiro (kirk.cumbo)'
check_leak '10[.]244[.]70[.]'   'IP de produção VK'
check_leak 'lumesolutions'   'Domínio pessoal (lumesolutions)'

# Count skills
SKILL_COUNT=$(find "$BUILD_DIR/.claude/skills" -name 'SKILL.md' | wc -l)
log_info "Skills encontrados: $SKILL_COUNT"

# Count MCP servers
MCP_COUNT=$(find "$BUILD_DIR/mcp-servers" -maxdepth 1 -name 'package.json' -not -path '*/node_modules/*' | wc -l)
# Also count dirs with package.json
MCP_DIR_COUNT=$(find "$BUILD_DIR/mcp-servers" -mindepth 2 -maxdepth 2 -name 'package.json' -not -path '*/node_modules/*' | wc -l)
log_info "MCP servers encontrados: $MCP_DIR_COUNT"

# Build size
BUILD_SIZE=$(du -sh "$BUILD_DIR" | cut -f1)
log_info "Tamanho da distribuição: $BUILD_SIZE"

echo ""
if $LEAK_FOUND; then
    log_error "═══ BUILD FALHOU — Vazamentos detectados ═══"
    echo ""
    log_error "Corrija os vazamentos acima e execute novamente."
    exit 1
else
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║     FORGE Build Concluído com Sucesso!                       ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo ""
    log_info "Distribuição em: $BUILD_DIR"
    log_info "Skills: $SKILL_COUNT | MCP Servers: $MCP_DIR_COUNT | Tamanho: $BUILD_SIZE"
    echo ""
    log_info "Próximos passos:"
    echo "  1. Revise: ls $BUILD_DIR"
    echo "  2. Teste:  cd $BUILD_DIR && ./setup/install.sh"
    echo ""
fi
