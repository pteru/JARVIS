---
type: Implementation Plan
title: Plugin Spec: `document-templates`
description: Centralizar os templates de documentos da Strokmatic em um plugin reutilizável, eliminando CSS duplicado e padronizando a identidade visual dos documentos gerados por qualquer workspace (JARVIS, Vi...
timestamp: 2026-04-04
---

# Plugin Spec: `document-templates`

> Strokmatic Marketplace Plugin — biblioteca de templates para geração de documentos profissionais

## Objetivo

Centralizar os templates de documentos da Strokmatic em um plugin reutilizável, eliminando CSS duplicado e padronizando a identidade visual dos documentos gerados por qualquer workspace (JARVIS, VisionKing, SpotFusion, DieMaster).

## Templates

### 1. `report` — Relatório Gerencial (HTML → PDF)
- **Referência:** `pmo/03002/reports/html/relatorio-gerencial-gpu-vk01.html`
- **Formato:** HTML self-contained → Chrome headless → PDF A4
- **Componentes:**
  - Header com gradiente navy (#0f3460 → #16213e), logo SVG, metadados (projeto, autor, data)
  - Severity banner (vermelho/amarelo/verde/azul)
  - KPI cards (4 cards lado a lado com métricas grandes)
  - Tabelas estilizadas (header navy, linhas alternadas, highlight/total rows)
  - Alert boxes (red, orange, blue, green) com borda lateral
  - Bar chart CSS-only com legenda
  - Timeline dots (visualização temporal)
  - Action items (números circulares)
  - Watermark (logo SVG 4% opacidade)
  - Footer com borda e texto cinza
  - `@page A4` com margens 8mm/0/12mm/0
- **Variáveis:** título, subtítulo, projeto, autor, data, severidade, conteúdo (seções)

### 2. `proposal` — Proposta Técnica (MD → PDF)
- **Referência:** `pmo/03010/reports/md/proposta-tecnica-03010.md`
- **Formato:** Markdown + HTML/CSS embutido → md-to-pdf → PDF
- **Componentes:**
  - Header bar com logo SVG + dados da empresa (CNPJ, endereço, telefone, email)
  - Borda inferior navy #1a3a5c
  - YAML frontmatter (title, subtitle, author, date, pdf_options)
  - Seções markdown com tabelas, listas, escopo técnico
  - Margens 20mm
- **Variáveis:** título, subtítulo, cliente, projeto, data, referência, conteúdo

### 3. `presentation` — Apresentação de Slides (Marp MD → PDF/PPTX)
- **Referência:** `pmo/reports/2026-03-31-gm-test-results/gm-test-results.md`
- **Formato:** Marp Markdown → PDF slides / PPTX
- **Componentes:**
  - Title slide (gradiente navy #1B3A5C → #0D2240, texto branco)
  - Divider slides (mesmo gradiente, para separar seções)
  - Content slides (fundo branco, texto navy)
  - Compact slides (font menor para tabelas densas)
  - Tabelas com header navy, linhas alternadas (#F5F7FA)
  - Cores: primary #1B3A5C, accent #058DC7, alert #ED561B
  - Paginação automática
- **Variáveis:** título, subtítulo, autor, data, slides (conteúdo markdown)

### 4. `quote` — Cotação Comercial (Python → HTML → PDF)
- **Referências:**
  - `pmo/tools/quote-generator/lume/generate.py` (Lume — premium, com imagens base64)
  - `pmo/tools/quote-generator/skm/generate.py` (Strokmatic — padrão)
- **Variantes:** Apenas `lume` e `strokmatic` (demais fornecedores excluídos)
- **Formato:** Python gera HTML pixel-accurate → Chrome headless → PDF A4
- **Componentes:**
  - Header com dados da empresa fornecedora
  - Separadores horizontais
  - Layout multi-coluna (cliente, referência)
  - Tabela de itens/produtos
  - Condições comerciais, fine print
  - Linha de assinatura
  - `@page A4` com margens 17mm/10mm/10mm/10mm
- **Variáveis:** fornecedor (lume|strokmatic), cliente, itens, condições, data, referência

### 5. `expense` — Prestação de Contas (XLSX + HTML → PDF)
- **Referência:** `workspaces/personal/reimbursement-automation/`
- **Formato dual:**
  - **XLSX** (operacional) — planilhas com fórmulas para preenchimento e submissão institucional
  - **HTML** (apresentação) — relatório visual estilizado para anexar ou imprimir
- **3 variantes institucionais:**

#### 5a. `expense/strokmatic` — Reembolso Strokmatic (MODELO.xlsx)
- **Referência:** `templates/MODELO.xlsx`
- **Estrutura:** Sheet única, resumo mensal por categoria
- **Categorias:** Combustível, Hotel, Pedágio, Almoço, Janta, Carro, Outros
- **Variáveis:** mês, viajante, despesas (data + valor por categoria)
- **HTML:** Relatório de reembolso com header Strokmatic, tabela de despesas por categoria, totais, assinatura

#### 5b. `expense/embrapii` — Prestação de Contas EMBRAPII
- **Referência:** `templates/EMBRAPII - Relatório de Prestação de Contas (Rev_set_2025) (1).xlsx`
- **Estrutura:** 10 sheets (Configurações + Consolidado + Viajante 1-10)
- **Modo:** Detalhado — linhas individuais por despesa (até 11 por viajante)
- **Categorias:** Alimentação, Hospedagem, Passagens, Transporte-Uber e taxi, Combustível, Pedágio e estacionamento, Frete
- **Variáveis:** projeto, viajantes (nome, banco, origem/destino, despesas individuais)
- **HTML:** Relatório consolidado multi-viajante com tabela detalhada de despesas, subtotais por viajante, total geral

#### 5c. `expense/senai-dn` — Prestação de Contas SENAI-DN
- **Referência:** `templates/PLATAFORMA DN - Relatório de Prestação de Contas (Rev_set_2025).xlsx`
- **Estrutura:** 9 sheets (Instruções + Compilado + Viajante 1-5 + Dados + Formulário)
- **Modo:** Consolidado — resumo por categoria (quantidade + valor)
- **Dois fluxos:** Adiantamento (pré-viagem) e Prestação de Contas (pós-viagem)
- **Categorias:** Passagem aérea/terrestre, Combustível, Táxi/Uber, Alimentação, Hospedagem, Pedágio, Estacionamento, Locação de Veículo, Outros
- **Variáveis:** projeto, instituição, unidade, viajantes (CPF, banco, diárias, despesas por categoria)
- **HTML:** RCDV — Relatório Consolidado de Despesas de Viagem com resumo por categoria, totais por viajante, bloco de assinaturas

### Automação de Recibos (integração com `expense`)
- **Script:** `fill_reimbursement.py` (Claude Vision API para OCR de recibos)
- **Input:** Pasta de viagem com fotos de recibos + PDFs de Uber/99
- **Output:** XLSX preenchido + PDFs individuais nomeados + email.txt
- **Detecção automática:** Classifica refeição por horário (café/almoço/janta), extrai estabelecimento, data, valor
- **Suporte:** Detecta automaticamente qual template (EMBRAPII vs SENAI-DN) e preenche as células corretas

## Arquitetura do Plugin

```
plugins/claude-code/document-templates/
├── SKILL.md                    # Skill /doc — entry point
├── assets/
│   ├── strokmatic-w.svg        # Logo branco (watermark)
│   ├── logo-strokmatic.svg     # Logo colorido (headers)
│   ├── logo-strokmatic.png     # Fallback PNG
│   └── colors.json             # Paleta de cores centralizada
├── templates/
│   ├── report.html             # Template relatório gerencial (Jinja2-like placeholders)
│   ├── proposal.md             # Template proposta técnica
│   ├── presentation.md         # Template Marp slides
│   ├── quote/
│   │   ├── strokmatic.py       # Gerador de cotação Strokmatic
│   │   └── lume.py             # Gerador de cotação Lume (premium, base64 assets)
│   └── expense/
│       ├── strokmatic.xlsx     # MODELO — reembolso mensal Strokmatic
│       ├── embrapii.xlsx       # Prestação de contas EMBRAPII (10 viajantes, linhas individuais)
│       ├── senai-dn.xlsx       # Prestação de contas SENAI-DN (5 viajantes, consolidado)
│       ├── report.html         # Template HTML para relatório visual de despesas
│       └── fill.py             # Automação: OCR de recibos (Claude Vision) → preenche XLSX
├── css/
│   ├── base.css                # Reset, tipografia, @page rules
│   ├── components.css          # Boxes, KPI cards, tables, bars, timeline, actions
│   └── themes/
│       ├── navy.css            # Tema padrão (navy/cyan)
│       └── dark.css            # Tema escuro (para web/tela)
├── scripts/
│   ├── render.sh               # Renderiza template → PDF (Chrome headless ou md-to-pdf)
│   └── preview.sh              # Abre preview no browser
└── examples/
    ├── report-example.html
    ├── proposal-example.md
    ├── presentation-example.md
    └── expense-example.html
```

## Paleta de Cores Centralizada (`colors.json`)

```json
{
  "primary": {
    "navy": "#0f3460",
    "navy-dark": "#16213e",
    "navy-light": "#1a3a5c",
    "navy-alt": "#1B3A5C"
  },
  "accent": {
    "cyan": "#058DC7",
    "cyan-light": "#2980b9"
  },
  "alert": {
    "red": "#e74c3c",
    "orange": "#f39c12",
    "green": "#27ae60",
    "blue": "#2980b9",
    "orange-alt": "#ED561B"
  },
  "neutral": {
    "text": "#1a1a2e",
    "text-light": "#555",
    "text-muted": "#777",
    "border": "#e0e0e0",
    "bg-alt": "#f8f9fb",
    "bg-row": "#F5F7FA"
  }
}
```

## Skill `/doc`

```
/doc report --project 03002 --title "Relatório Mensal" --severity alta
/doc proposal --project 03010 --client "Stellantis"
/doc presentation --project 03003 --title "Resultados Q1"
/doc quote --supplier strokmatic --client "ArcelorMittal"
/doc expense --variant strokmatic --month "2026-03" --traveler "Pedro Teruel"
/doc expense --variant embrapii --project "SPIN" --folder ~/Viagem_SJC/
/doc expense --variant senai-dn --project "SPIN" --folder ~/Viagem_SJC/
/doc expense fill <pasta_viagem> [--template embrapii|senai-dn]   # OCR de recibos → XLSX
/doc preview <file>          # Abre no browser
/doc export <file>           # Renderiza para PDF
```

### Fluxo do skill

1. Carrega o template base do tipo solicitado
2. Preenche metadados do projeto via `config/project-codes.json`
3. Injeta CSS de `css/base.css` + `css/components.css` + tema
4. Injeta assets (logos) como base64 ou referência local
5. Gera o arquivo (HTML/MD) no diretório do projeto (`pmo/{code}/reports/`)
6. Opcionalmente exporta para PDF via `render.sh`

## Migração dos Templates Existentes

| Template atual | Destino no plugin | Ação |
|---|---|---|
| `pmo/03002/reports/html/relatorio-gerencial-gpu-vk01.html` | `templates/report.html` | Extrair CSS → `components.css`, parametrizar conteúdo |
| `pmo/03010/reports/md/proposta-tecnica-03010.md` | `templates/proposal.md` | Extrair header CSS → `base.css`, parametrizar |
| `pmo/reports/gm-test-results/gm-test-results.md` | `templates/presentation.md` | Extrair Marp CSS → `themes/navy.css`, parametrizar |
| `pmo/tools/quote-generator/skm/generate.py` | `templates/quote/strokmatic.py` | Migrar, usar `colors.json` |
| `pmo/tools/quote-generator/lume/generate.py` | `templates/quote/lume.py` | Migrar, usar `colors.json` |
| `personal/reimbursement-automation/templates/MODELO.xlsx` | `templates/expense/strokmatic.xlsx` | Copiar template Strokmatic |
| `personal/reimbursement-automation/templates/EMBRAPII*.xlsx` | `templates/expense/embrapii.xlsx` | Copiar template EMBRAPII |
| `personal/reimbursement-automation/templates/PLATAFORMA DN*.xlsx` | `templates/expense/senai-dn.xlsx` | Copiar template SENAI-DN |
| `personal/reimbursement-automation/fill_reimbursement.py` | `templates/expense/fill.py` | Migrar automação OCR |
| (novo) | `templates/expense/report.html` | Criar HTML visual de despesas no estilo Strokmatic |
| `visionking/toolkit/defect-report-toolkit/assets/` | `assets/` | Copiar logos SVG/PNG |

## Dependências

- `md-to-pdf` (Node.js) — para templates Markdown
- Google Chrome (`/usr/bin/google-chrome`) — para HTML → PDF
- Marp CLI (`npx @marp-team/marp-cli`) — para apresentações
- Python 3 — para gerador de cotações e automação de recibos
- `anthropic` (Python) — Claude Vision API para OCR de recibos
- `openpyxl` (Python) — manipulação de XLSX
- `Pillow` (Python) — processamento de imagens de recibos
- `poppler-utils` — extração de texto de PDFs (Uber/99)

## Prioridade de Implementação

1. **Assets + paleta** — centralizar logos e cores
2. **`report` template** — maior valor imediato (relatórios gerenciais para clientes)
3. **`expense` template** — 3 variantes XLSX + HTML visual + automação OCR
4. **`proposal` template** — propostas técnicas recorrentes
5. **`presentation` template** — apresentações de resultados
6. **`quote` template** — cotações Strokmatic e Lume (já funcional, apenas migrar)
