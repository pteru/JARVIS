# Análise de Churn — SpotFusion

**Produto:** SpotFusion (inspeção visual de solda a ponto)<br>
**Contexto:** Startup indtech de alto risco — early-stage<br>
**Data:** 2026-05-15<br>
**Autor:** Pedro Teruel

> **Ressalva:** esta análise é um raciocínio sobre o **modelo de negócio** do SpotFusion a partir do que se sabe do projeto (perfil vision-only, ciclo demo→piloto→produção do 02008 Nissan Smyrna). **Não usa dados financeiros reais** de receita ou contratos. Com os números reais de demos/pilotos é possível calcular as taxas efetivas e compará-las aos benchmarks abaixo.

---

## 1. Benchmarks de referência (mercado)

### B2B SaaS maduro (para comparação)

- Churn de receita anual saudável: **5–7%**
- Churn de logo (clientes) mid-market: **10–15%/ano**
- Enterprise puro: **<5%/ano** (contratos longos, alto custo de troca)

### Startup indtech early-stage de alto risco

- Churn de logo anual realista: **20–40%**
- Em fase de **piloto/POC** (antes de virar contrato de produção): pode passar de **50%** — muitos pilotos simplesmente não convertem, e isso é esperado, não necessariamente um sinal ruim.

---

## 2. Por que indtech é diferente

**A favor (churn estrutural mais baixo depois de integrado):**

- Hardware instalado em linha de produção = altíssimo custo de troca
- Ciclos de venda e contratos longos
- Cliente integra ao processo dele — sair dói

**Contra (churn alto no início):**

- Vendas concentradas em poucos clientes grandes → perder 1 cliente = 10–20% de churn de receita de uma vez (concentração distorce a métrica)
- Produto imaturo, falhas de campo, ROI ainda não comprovado
- "Churn de piloto" inflado: muitos contratos são experimentais

---

## 3. Como o churn realmente se comporta no SpotFusion

O modelo de negócio do SpotFusion **não é SaaS de assinatura** — é deployment industrial por planta/linha (02008 Nissan Smyrna, etc.). O ciclo de vida de um cliente tem **três pontos de churn distintos**, cada um com taxa esperada bem diferente.

### 3.1. Churn de demo → piloto

- O 02008 está em fase de demo (target **2026-06-25**, perfil vision-only).
- Aqui o "churn" é a demo não virar piloto pago.
- Esperado para indtech de alto risco: **perder 40–60% das demos é normal**. Demo é prospecção, não cliente.

### 3.2. Churn de piloto → produção (o mais crítico)

- Piloto = sistema rodando numa linha, validando conformância (100% = green).
- Conversão piloto→produção realista: **30–50%**.
- O risco aqui é técnico e mensurável: se a taxa de conformância não bate, ou há falsos positivos demais, o piloto morre. É o gate onde a maturidade do produto é testada de verdade.

### 3.3. Churn de produção → abandono / não-expansão

- Uma vez instalado numa linha de produção automotiva, o custo de troca é **altíssimo** — câmera, mounts, integração PLC, joints calibrados.
- Churn de produção esperado: **muito baixo, <10%/ano**.
- O verdadeiro risco não é "cancelar", é **não expandir**: a planta usa em 1 linha e não compra para as outras.

---

## 4. Números considerados "saudáveis" para o SpotFusion

| Métrica | Aceitável (alto risco) | Sinal de alerta |
|---|---|---|
| Demo → piloto | converter ~40–60% | <30% = problema de posicionamento/preço |
| Piloto → produção | converter 30–50% | <30% = problema de produto/conformância |
| Churn de produção anual | <10% | >15% = falha de campo recorrente |
| Expansão dentro da conta | ≥1 linha nova/ano por planta ativa | 0 = produto não provou ROI |

---

## 5. Por que o caso 02008 distorce qualquer % de churn hoje

Com basicamente **um cliente de referência (Nissan Smyrna)**:

- Perder o 02008 = **100% de churn de logo**. A métrica percentual é inútil nesse estágio.
- O indicador que importa hoje **não é churn — é conversão**: a demo de 2026-06-25 virar piloto, e o piloto virar contrato de produção em mais linhas.

---

## 6. Recomendações

1. **Separe churn de piloto de churn de produção** — misturar os dois gera uma métrica inútil.
2. **Enquanto o SpotFusion estiver em 1–3 contas, não reporte "% de churn"** — reporte o **funil de conversão** (demos ativas → pilotos → linhas em produção) e a **NRR por planta** (expansão dentro da conta).
3. Churn como métrica só passa a fazer sentido quando houver **~10+ plantas em produção**.
4. Com poucos clientes, olhe **churn de receita e net revenue retention**, não % de logos — com 8 clientes, um único cancelamento vira "12,5% de churn" e o número perde sentido.

---

## Histórico de Mudanças

| Data | Versão | Descrição | Autor |
|---|---|---|---|
| 2026-05-15 | 1.0 | Versão inicial da análise de churn do SpotFusion | Pedro Teruel |
