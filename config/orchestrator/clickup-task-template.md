# Template de Descrição de Tarefas — ClickUp

> Usado pelas automações de sprint planning (Claude Code + ClickUp MCP).
> Todas as descrições em **PT-BR**, que é o idioma oficial do ClickUp.

## Template

```markdown
## Contexto

[De onde surgiu a tarefa — reunião, análise, incidente, etc. Incluir código do projeto se aplicável (ex: 01001). Referências a timestamps da reunião entre parênteses (ex: 00:26:00).]

## Objetivo

[O que deve ser feito — uma descrição clara e concisa do resultado esperado. Não descrever o "como", apenas o "o quê" e o "por quê".]

## Abordagem sugerida

[Opcional. Passos ou estratégia discutidos na reunião. Incluir apenas quando a reunião definiu um caminho específico.]

1. Passo um
2. Passo dois
3. Passo três

## Dependências

[Opcional. Outras tarefas que precisam ser concluídas antes, ou tarefas relacionadas em outros repos.]

- Depende de: [nome da tarefa ou link]
- Relacionada: [repo#issue ou link ClickUp]

## Critérios de aceite

- [ ] Critério verificável 1
- [ ] Critério verificável 2
- [ ] Critério verificável 3

## Observações

[Opcional. Notas adicionais, riscos, decisões em aberto, ou informações de contexto que ajudam o responsável.]
```

## Regras

1. **Idioma:** Sempre PT-BR. Termos técnicos em inglês são aceitos quando são o padrão da área (ex: firmware, timestamp, deploy, frontend).

2. **Contexto é obrigatório.** Sem contexto, a tarefa perde significado após duas semanas. Incluir:
   - De onde veio (reunião de sprint, análise de dados, incidente)
   - Código do projeto quando aplicável (ex: SJC-01001, ArcelorBM-03002)
   - Referência à fonte (ex: "Reunião de review de dados do teste Smart Die, 2026-04-06")

3. **Objetivo é obrigatório.** Descrever o estado final desejado, não o processo.
   - ✅ "Garantir que dados brutos sejam salvos no banco independentemente do data processing"
   - ❌ "Mexer no get-data para salvar dados"

4. **Critérios de aceite são obrigatórios.** Usar checkbox markdown (`- [ ]`). Cada critério deve ser verificável objetivamente.
   - ✅ "Timestamp de stop acquisition registrado no banco para cada painel"
   - ❌ "Funcionar corretamente"

5. **Abordagem é opcional.** Incluir apenas quando a reunião definiu passos concretos. Não inventar abordagem — se não foi discutido, deixar para o responsável decidir.

6. **Dependências:** Incluir quando existirem. Usar formato `repo#issue` para GitHub ou link direto do ClickUp. Mencionar quando a tarefa é sub-tarefa de outra.

7. **Observações:** Usar para riscos, decisões em aberto, ou contexto que não se encaixa nas outras seções. Não usar como lixeira — se a informação é importante, ela pertence ao Contexto ou Objetivo.

8. **Tamanho:** A descrição inteira não deve exceder ~300 palavras. Se precisar de mais, a tarefa provavelmente deve ser subdividida.

## Exemplo completo

```markdown
## Contexto

No teste SJC-01001 (Smart Die), o fix do data processing causou perda dos timesteps para ~350 curvas após as 13 primeiras. O data process descartava a informação temporal ao processar, e quando falhou, os dados brutos ficaram sem timestep. Reunião de review de dados, 2026-04-06 (00:26:00).

## Objetivo

Alterar o `diemaster-get-data` para salvar o dado bruto (valores + timestep) diretamente no banco, sem depender do pipeline de data processing. Garantir que mesmo se o data process falhar, os dados brutos com timestep estejam persistidos.

## Abordagem sugerida

Seguir o padrão VisionKing: frame é salvo no banco antes da inferência. Dados brutos salvos independentemente do resultado do processamento.

1. Identificar ponto de intercepção dos dados brutos no get-data
2. Criar tabela dedicada para dados brutos (schema no infra-setup)
3. Inserir dados brutos antes de encaminhar para o data processing

## Dependências

- Relacionada: strokmatic/diemaster#30 (segunda instância do database-writer)
- Relacionada: strokmatic/diemaster-infra-setup#5 (funções de inserção em duas etapas)

## Critérios de aceite

- [ ] Get-data salva dados brutos + timestep em tabela dedicada
- [ ] Salvamento não depende do pipeline de data processing
- [ ] Dados brutos acessíveis mesmo se processing falhar
- [ ] Testes de integração cobrindo cenário de falha no processing

## Observações

Similar ao padrão usado no VisionKing (frame salvo antes da inferência) e SpotFusion (dados salvos antes da inferência). Prioridade alta — previne perda de dados em futuros testes.
```

## Prefixos de nome de tarefa

| Prefixo | Categoria | Lista padrão |
|---|---|---|
| `sw:` | Software geral | [XX] Software |
| `front:` / `back:` | Frontend / Backend | [XX] Front/Back ou Software |
| `fw:` | Firmware | [XX] Projeto Eletrônico |
| `ds:` | Data science / modelos | [XX] Modelos |
| `hw:` / `sensor:` | Hardware / eletrônica | [XX] Projeto Eletrônico ou Hardware |
| `doc:` | Documentação | [XX] Documentação |
| `lab:` | Laboratório | [XX] Laboratório |
| `infra:` | Infraestrutura / deploy | [XX] Software |
| `sjc:` / `flint:` / etc. | Projeto específico | Lista do projeto (ex: [01001]) |
