#!/usr/bin/env python3
"""Generate an OKF topic specialist: session skill + dispatchable agent.

Renders .claude/skills/<slug>/SKILL.md and .claude/agents/<slug>-specialist.md
from embedded templates and appends the slug to the roster table in
journal/BOOT.md. Refuses to overwrite an existing specialist without --force.
Stdlib only.
"""
import argparse
import sys
from pathlib import Path

SKILL_TEMPLATE = """---
name: {slug}
description: Especialista em {terms} — carrega contexto OKF recente do tópico
---

# Especialista: {slug}

Assuma a persona de especialista no tópico **{slug}** (classe: {cls}).

## Boot (convenção canônica: `journal/BOOT.md`)

1. Leia `~/JARVIS/knowledge/index.md` (catálogo de bundles OKF).
2. Busque contexto recente:
   `python3 ~/JARVIS/scripts/okf/okf.py search {terms} --tag {slug}`{project_step}
3. Leia as 2–3 entradas mais recentes de `~/JARVIS/journal/` do tópico (data no
   nome do arquivo), filtrando pela sub-tag da tarefa quando o tópico for amplo.
4. Leia as páginas OKF que essas entradas linkam{pages_hint} —
   progressive disclosure, nunca leitura exaustiva.
5. Só então aja. Cite as fontes OKF (caminhos) nas respostas.

## Encerramento

Ao final do bloco de trabalho, escreva `~/JARVIS/journal/YYYY-MM-DD-{slug}.md`
(Feito · Decisões · Pendências · Links; PT-BR; 20–40 linhas; tags
`[{tags}]`; **NUNCA segredos/credenciais**) e rode
`python3 ~/JARVIS/scripts/okf/okf.py index journal`.
"""

AGENT_TEMPLATE = """---
name: {slug}-specialist
description: Especialista em {terms}. Use para perguntas e tarefas do tópico {slug}; rehidrata contexto do journal e dos bundles OKF antes de responder.
tools: Read, Bash, Grep, Glob
model: sonnet
---

Você é o especialista no tópico **{slug}** (classe: {cls}).

Antes de qualquer tarefa, boot (convenção: `~/JARVIS/journal/BOOT.md`):

1. Leia `~/JARVIS/knowledge/index.md` (catálogo de bundles OKF).
2. Rode `python3 ~/JARVIS/scripts/okf/okf.py search {terms} --tag {slug}`{project_step}
3. Leia as 2–3 entradas mais recentes de `~/JARVIS/journal/` do tópico (data no
   nome do arquivo), filtrando pela sub-tag da tarefa quando o tópico for amplo.
4. Leia as páginas OKF que essas entradas linkam{pages_hint} —
   progressive disclosure, nunca leitura exaustiva.

Sua mensagem final é o entregável devolvido ao chamador: responda de forma
completa e cite as fontes OKF (caminhos de arquivo) usadas. Você é read-only:
não edite arquivos, não faça commits e **nunca exponha segredos/credenciais**.
"""

ROSTER_HEADER = "| Slug | Classe | Termos de busca | Tags |"


def _render(template, args):
    project_step = (
        "\n   e repita com `--project \"{0}\"` para a camada do projeto."
        .format(args.project) if args.project else ""
    )
    pages_hint = (
        " (comece por: {0})".format(args.pages) if args.pages else ""
    )
    return template.format(slug=args.slug, terms=args.terms, tags=args.tags,
                           cls=args.cls, project_step=project_step,
                           pages_hint=pages_hint)


def _update_roster(boot_path, args):
    lines = boot_path.read_text(encoding="utf-8").splitlines()
    row = "| {0} | {1} | {2} | {3} |".format(
        args.slug, args.cls, args.terms, args.tags)
    lines = [l for l in lines if not l.startswith("| {0} |".format(args.slug))]
    lines.append(row)
    boot_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def default_root():
    return Path(__file__).resolve().parent.parent.parent


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("slug")
    ap.add_argument("--class", dest="cls", required=True,
                    choices=["project", "field"])
    ap.add_argument("--terms", required=True, help="okf search terms")
    ap.add_argument("--tags", required=True, help="comma-separated journal tags")
    ap.add_argument("--project", default=None, help='quoted 5-digit code')
    ap.add_argument("--pages", default=None,
                    help="comma-separated starter knowledge pages")
    ap.add_argument("--agent-only", action="store_true",
                    help="skip the skill (slug collides with an existing skill)")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--root", default=None, help="repo root (tests)")
    args = ap.parse_args(argv)

    root = Path(args.root) if args.root else default_root()
    skill_path = root / ".claude" / "skills" / args.slug / "SKILL.md"
    agent_path = root / ".claude" / "agents" / (args.slug + "-specialist.md")
    boot_path = root / "journal" / "BOOT.md"

    targets = [agent_path] if args.agent_only else [skill_path, agent_path]
    if not args.force:
        clashes = [p for p in targets if p.exists()]
        if clashes:
            print("refusing to overwrite (use --force): "
                  + ", ".join(str(p) for p in clashes), file=sys.stderr)
            return 1
    if not boot_path.exists():
        print("journal/BOOT.md not found under root: {0}".format(root),
              file=sys.stderr)
        return 1

    if not args.agent_only:
        skill_path.parent.mkdir(parents=True, exist_ok=True)
        skill_path.write_text(_render(SKILL_TEMPLATE, args), encoding="utf-8")
    agent_path.parent.mkdir(parents=True, exist_ok=True)
    agent_path.write_text(_render(AGENT_TEMPLATE, args), encoding="utf-8")
    _update_roster(boot_path, args)
    for p in targets:
        print(p)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
