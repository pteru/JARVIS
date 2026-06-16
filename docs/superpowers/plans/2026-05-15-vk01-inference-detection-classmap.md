# Correção da inferência VK01 — troca p/ modelo detection + mapeamento de classes

> **Para executores:** plano de **operação em produção** (vk01, projeto 03002). Não é um plano de código com TDD — cada tarefa tem um **gate de verificação** baseado em evidência (saída de comando / query). Execute fase a fase; **pare e confirme com o Pedro entre fases**. Use checkboxes (`- [ ]`) para acompanhar.

**Objetivo:** Restaurar a gravação de defeitos na tabela `defeitos` (parada desde 24/abr/2026), trocando o modelo OBB pelo modelo detection equivalente e alinhando o mapeamento de classes ao modelo novo.

**Arquitetura:** O modelo OBB emite `position` como polígono de 4 cantos, que quebra a função PL/pgSQL `insert_defects_inpects` (espera `[x1,y1,x2,y2]` plano). O modelo detection emite bbox plano — compatível com a função sem mexer em código. Sobre essa base, corrige-se o mapeamento de classes em três camadas: `rules.json` (nomes crus do modelo) → `DEFECT_CLASSES` (filtro) → `DEFECT_CLASS_MAPPING` (nome→id) → `classe_defeitos` (banco).

**Stack:** vk01 `10.244.70.26:8050` (SSH), Docker Compose, PostgreSQL 15 (container `database-server`, DB `vk01`), modelo YOLO11 ONNX, RabbitMQ.

---

## Decisões aprovadas (Pedro, 15/05/2026)

| # | Decisão | Escolha |
|---|---|---|
| 1 | Modelo | **Detection** (`.190`), em vez de corrigir o OBB |
| 2 | Split `po_flux`/`carepa` | **Por região da corrida** — A–E (Resende)→po_flux; F–M (Monlevade)→carepa |
| 3 | Classes extras a persistir | **trinca, risco_aprova, farpa, mancha** (reflexo **não**) |
| 4 | Filtro de `amasso` por câmera | **Manter** — amasso só nas câmeras 2, 4, 5 |

## Configuração-alvo (resultado final)

**Modelo:** `09_02_2026_16_53_Arcelor_sem_sinteticas_Yolo_Padrao` (`task: detect`, base `yolo11n.pt`, ONNX com H/W dinâmico — `INPUT_SIZE` atual 1632×1280 permanece válido).

**9 classes do modelo** (índices idênticos ao OBB): `0:amasso 1:farpa 2:mancha 3:marca_mec 4:po_flux 5:risco_analise 6:risco_aprova 7:trinca 8:reflexo`.

**Camada A → B → C:**
- `rules.json` (casa nomes **crus** do modelo): 2 regras — filtro de amasso por câmera + transform `po_flux→carepa` para corridas F–M.
- `DEFECT_CLASSES` (filtro, nomes **pós-regra**): `["amasso","po_flux","carepa","marca_mec","risco_analise","risco_aprova","trinca","farpa","mancha"]` — `reflexo` fica de fora ⇒ descartado.
- `DEFECT_CLASS_MAPPING` (nome pós-regra → `classe_defeitos.id`): `{"amasso":"6","po_flux":"3","carepa":"5","marca_mec":"4","risco_analise":"2","risco_aprova":"7","trinca":"8","farpa":"9","mancha":"10"}`.
- `classe_defeitos`: adicionar 2 linhas — `farpa` (id 9) e `mancha` (id 10). As demais (2–8) já existem com a nomenclatura nova.

**Invariante de segurança:** todo nome em `DEFECT_CLASSES` é chave em `DEFECT_CLASS_MAPPING`, e todo valor do mapping (2–10) existe em `classe_defeitos.id`. Sem isso, a função casta `class_id=0` → viola a FK `defeitos_class_id_fkey` → mensagem perdida.

## Helpers (executar da máquina JARVIS)

```bash
# Senha <skm-password> vale para vk01 (user vk01) e para .190 (user skm)
PW=/home/teruel/.secrets/vk-ssh-password
VKSSH="sshpass -f $PW ssh -p 8050 -o StrictHostKeyChecking=no -o ConnectTimeout=15 vk01@10.244.70.26"
VKSCP="sshpass -f $PW scp -P 8050 -o StrictHostKeyChecking=no"
SKM190="sshpass -f $PW ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 skm@192.168.15.190"
SKMSCP="sshpass -f $PW scp -o StrictHostKeyChecking=no"
# psql no vk01 (DB vk01):
PSQL() { $VKSSH "docker exec -e PGPASSWORD=<skm-password> database-server psql -U strokmatic -d vk01 -tA -c \"$1\""; }
```

> **Pré-requisito:** VPN Checkpoint ativa (CShell na porta 14186) — o vk01 só é alcançável por ela.

---

## Fase 0 — Preparação, backups e linha de base

### Task 0.1: Capturar a linha de base (read-only)

**Files:** nenhum — apenas leitura.

- [ ] **Step 1: Registrar o estado atual de `defeitos`**

```bash
PSQL "SELECT COUNT(*) AS total, MAX(inserted_at) AS ultimo, COUNT(*) FILTER (WHERE inserted_at > now()-interval '1 hour') AS ultima_hora FROM defeitos;"
```

Esperado (antes da correção): `ultima_hora = 0` e `ultimo` ≈ `2026-04-24 09:10`. Anote os valores — servem de comparação na Fase 5.

- [ ] **Step 2: Registrar a taxa de erro do result-writer**

```bash
$VKSSH "docker logs --tail 5000 visionking-result-writer 2>&1 | grep -c 'invalid input syntax for type numeric'"
```

Esperado: número > 0 (atualmente ~95 a cada 5000 linhas). Anote.

### Task 0.2: Backups dos arquivos de configuração

**Files:**
- Backup: `/home/vk01/Downloads/visionking-inference-c017.yml` → `.bak-2026-05-15`
- Backup: `/home/vk01/Downloads/rules/rules.json` → `.bak-2026-05-15`

- [ ] **Step 1: Backup do compose e do rules.json no vk01**

```bash
$VKSSH "cp -v /home/vk01/Downloads/visionking-inference-c017.yml /home/vk01/Downloads/visionking-inference-c017.yml.bak-2026-05-15 && cp -v /home/vk01/Downloads/rules/rules.json /home/vk01/Downloads/rules/rules.json.bak-2026-05-15"
```

Esperado: duas linhas `'...' -> '...bak-2026-05-15'`.

- [ ] **Step 2: Trazer uma cópia local dos dois arquivos (referência/rollback)**

```bash
$VKSCP vk01@10.244.70.26:/home/vk01/Downloads/visionking-inference-c017.yml /tmp/vk01-compose.orig.yml
$VKSCP vk01@10.244.70.26:/home/vk01/Downloads/rules/rules.json /tmp/vk01-rules.orig.json
```

Esperado: dois arquivos em `/tmp` (compose ~4,2 KB, rules ~1,8 KB).

### Task 0.3: Backup da tabela `classe_defeitos`

**Files:** nenhum — dump para CSV local.

- [ ] **Step 1: Exportar as 8 linhas atuais**

```bash
$VKSSH "docker exec -e PGPASSWORD=<skm-password> database-server psql -U strokmatic -d vk01 -c \"\\copy classe_defeitos TO STDOUT WITH CSV HEADER\"" > /tmp/classe_defeitos.bak-2026-05-15.csv
cat /tmp/classe_defeitos.bak-2026-05-15.csv
```

Esperado: cabeçalho + 8 linhas (ids 1–8). Guardar o arquivo.

**⛔ Gate de fase:** confirmar com o Pedro que a linha de base e os backups estão OK antes de prosseguir.

---

## Fase 1 — `classe_defeitos`: cadastrar `farpa` e `mancha`

> Tem de vir **antes** das env vars: o `DEFECT_CLASS_MAPPING` vai apontar `farpa→9` e `mancha→10`; se as linhas não existirem, a FK quebra.

### Task 1.1: Inserir as classes `farpa` e `mancha`

**Files:** tabela `classe_defeitos` no DB `vk01`.

- [ ] **Step 1: Conferir que os ids 9 e 10 estão livres**

```bash
PSQL "SELECT COUNT(*) FROM classe_defeitos WHERE id IN (9,10);"
```

Esperado: `0`.

- [ ] **Step 2: Inserir as duas linhas**

> ⚠️ **Validar com a engenharia (Vanessa) antes de rodar:** `category_code`, `group_name` e `aggregation` afetam a lógica de agregação/aprovação de peça. Os valores abaixo são conservadores (`status='aprova'`, `stop_production_line=false`, `mode=unico` — defeito pontual que **não** reprova/para linha). Ajuste se a engenharia definir diferente.

```bash
cat <<'SQL' | $VKSSH "docker exec -i -e PGPASSWORD=<skm-password> database-server psql -U strokmatic -d vk01"
INSERT INTO classe_defeitos
 (id, defect_class_name, category_code, id_group, group_name, status, stop_production_line, defect_class_code, aggregation)
VALUES
 (9,  'Farpa',  'F', 9,  'Farpa',  'aprova', false, 'farpa',  '{"mode":"unico","parameters":{}}'::jsonb),
 (10, 'Mancha', 'N', 10, 'Mancha', 'aprova', false, 'mancha', '{"mode":"unico","parameters":{}}'::jsonb);
SQL
```

Esperado: `INSERT 0 2`.

- [ ] **Step 3: Verificar**

```bash
PSQL "SELECT id, defect_class_code, defect_class_name, status FROM classe_defeitos ORDER BY id;"
```

Esperado: 10 linhas; ids 9 (`farpa`) e 10 (`mancha`) presentes.

**⛔ Gate de fase:** confirmar 10 linhas com o Pedro.

---

## Fase 2 — Copiar o modelo detection para o vk01

### Task 2.1: Baixar o modelo da `.190` para a máquina JARVIS

**Files:**
- Origem: `192.168.15.190:/home/skm/Desktop/yolo-sis-surface/runs/detect/09_02_2026_16_53_Arcelor_sem_sinteticas_Yolo_Padrao/weights/best.onnx`
- Destino temporário: `/tmp/detection-best.onnx`

- [ ] **Step 1: Copiar best.onnx**

```bash
$SKMSCP skm@192.168.15.190:/home/skm/Desktop/yolo-sis-surface/runs/detect/09_02_2026_16_53_Arcelor_sem_sinteticas_Yolo_Padrao/weights/best.onnx /tmp/detection-best.onnx
md5sum /tmp/detection-best.onnx; ls -la /tmp/detection-best.onnx
```

Esperado: arquivo ~10,9 MB (10945707 bytes). Anotar o md5.

### Task 2.2: Enviar o modelo para o vk01

**Files:**
- Destino: `/home/vk01/Downloads/models/detect/09_02_2026_16_53_Arcelor_sem_sinteticas_Yolo_Padrao/weights/best.onnx`
- (montado no container como `/home/strokmatic/models/detect/.../weights/best.onnx`)

- [ ] **Step 1: Criar o diretório de destino no vk01**

```bash
$VKSSH "mkdir -p /home/vk01/Downloads/models/detect/09_02_2026_16_53_Arcelor_sem_sinteticas_Yolo_Padrao/weights"
```

- [ ] **Step 2: Enviar o arquivo**

```bash
$VKSCP /tmp/detection-best.onnx vk01@10.244.70.26:/home/vk01/Downloads/models/detect/09_02_2026_16_53_Arcelor_sem_sinteticas_Yolo_Padrao/weights/best.onnx
```

- [ ] **Step 3: Verificar integridade (md5 igual ao da Task 2.1)**

```bash
$VKSSH "md5sum /home/vk01/Downloads/models/detect/09_02_2026_16_53_Arcelor_sem_sinteticas_Yolo_Padrao/weights/best.onnx"
```

Esperado: md5 idêntico ao anotado na Task 2.1, Step 1.

**⛔ Gate de fase:** md5 confere.

---

## Fase 3 — Atualizar o `rules.json`

> O `rule_engine` recarrega o `rules.json` por mtime (hot-reload) — **não exige recreate**. As 2 regras casam os nomes **crus** do modelo (`amasso`, `po_flux`).

### Task 3.1: Substituir o `rules.json`

**Files:**
- Modify: `/home/vk01/Downloads/rules/rules.json` (no vk01)
- Staging local: `/tmp/vk01-rules.new.json`

- [ ] **Step 1: Escrever o novo rules.json localmente**

Criar `/tmp/vk01-rules.new.json` com exatamente este conteúdo:

```json
[
  {
    "rule_name": "Descartar 'amasso' fora das cameras 2, 4 e 5",
    "description": "Amasso (amassamento de raio) so e valido nas cameras 2, 4 ou 5. Em qualquer outra camera, e filtrado.",
    "conditions": [
      { "field": "defect.class", "operator": "equals", "value": "amasso" },
      { "field": "frame.camera_id", "operator": "not_in", "value": ["2", "4", "5"] }
    ],
    "action": { "type": "FILTER" }
  },
  {
    "rule_name": "Transformar 'po_flux' em 'carepa' nas corridas F-M (Monlevade)",
    "description": "Defeito po_flux numa corrida cujo tracking comeca entre F e M (Monlevade) tem a classe transformada em carepa. Corridas A-E (Resende) permanecem po_flux.",
    "conditions": [
      { "field": "defect.class", "operator": "equals", "value": "po_flux" },
      { "field": "frame.corrida_tracking", "operator": "has", "value": ["F", "G", "H", "I", "J", "K", "L", "M"] }
    ],
    "action": { "type": "TRANSFORM", "target_field": "defect.class", "new_value": "carepa" }
  }
]
```

- [ ] **Step 2: Validar o JSON localmente**

```bash
python3 -c "import json; print(len(json.load(open('/tmp/vk01-rules.new.json'))), 'regras OK')"
```

Esperado: `2 regras OK`.

- [ ] **Step 3: Enviar para o vk01**

```bash
$VKSCP /tmp/vk01-rules.new.json vk01@10.244.70.26:/home/vk01/Downloads/rules/rules.json
```

- [ ] **Step 4: Confirmar o reload no log da inferência**

```bash
sleep 5
$VKSSH "docker logs --tail 200 visionking-inference 2>&1 | grep -E 'Reloading rules|Successfully loaded'"
```

Esperado: linha `Successfully loaded 2 rules.` (o engine recarrega na próxima aplicação de regras).

**⛔ Gate de fase:** 2 regras carregadas.

---

## Fase 4 — Compose: env vars + troca de modelo + recreate

> Esta fase derruba e recria o container da inferência. Esperado: **parada curta** + **build do engine TensorRT no primeiro batch** (alguns minutos) — durante esse tempo a fila `is-sis-surface-queue` acumula e drena depois. Fazer, de preferência, numa janela de menor produção.

### Task 4.1: Editar o arquivo compose

**Files:**
- Modify: `/home/vk01/Downloads/visionking-inference-c017.yml` (4 linhas no bloco `environment`)
- Staging local: `/tmp/vk01-compose.orig.yml` (já trazido na Task 0.2)

- [ ] **Step 1: Trabalhar sobre a cópia local**

```bash
cp /tmp/vk01-compose.orig.yml /tmp/vk01-compose.new.yml
```

- [ ] **Step 2: Aplicar as 4 trocas** no `/tmp/vk01-compose.new.yml`

| Linha atual | Trocar por |
|---|---|
| `      - MODEL_TYPE=obb # [detection\|classification]` | `      - MODEL_TYPE=detection # [detection\|classification\|obb]` |
| `      - MODEL_PATH=models/detect/11_02_2026_14_47_Arcelor_Ponto1_sem_sinteticas_OBB_Deploy1/weights/best.onnx` | `      - MODEL_PATH=models/detect/09_02_2026_16_53_Arcelor_sem_sinteticas_Yolo_Padrao/weights/best.onnx` |
| `      - DEFECT_CLASSES=["amasso","risco","carepa","marca_mec","po_flux"]` | `      - DEFECT_CLASSES=["amasso","po_flux","carepa","marca_mec","risco_analise","risco_aprova","trinca","farpa","mancha"]` |
| `      - DEFECT_CLASS_MAPPING={"amasso":"6","carepa":"5","marca_mec":"4","po_flux":"3","risco":"2"}` | `      - DEFECT_CLASS_MAPPING={"amasso":"6","po_flux":"3","carepa":"5","marca_mec":"4","risco_analise":"2","risco_aprova":"7","trinca":"8","farpa":"9","mancha":"10"}` |

> `INPUT_SIZE_X=1632` / `INPUT_SIZE_Y=1280` **permanecem** — o ONNX detection tem H/W dinâmico. A tag da imagem (`:obb`) **permanece** — é só rótulo; a mesma imagem suporta `MODEL_TYPE=detection`.

- [ ] **Step 3: Conferir que só 4 linhas mudaram**

```bash
diff /tmp/vk01-compose.orig.yml /tmp/vk01-compose.new.yml
```

Esperado: exatamente 4 blocos de diff (as 4 linhas acima). Qualquer linha extra = erro — refazer.

- [ ] **Step 4: Enviar o compose editado para o vk01**

```bash
$VKSCP /tmp/vk01-compose.new.yml vk01@10.244.70.26:/home/vk01/Downloads/visionking-inference-c017.yml
```

### Task 4.2: Recriar o container

**Files:** container `visionking-inference`.

- [ ] **Step 1: Recriar via docker-compose**

```bash
$VKSSH "cd /home/vk01/Downloads && docker-compose -f visionking-inference-c017.yml up -d"
```

Esperado: `Recreating visionking-inference ... done`.

- [ ] **Step 2: Confirmar que as env vars novas pegaram**

```bash
$VKSSH "docker inspect visionking-inference --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E 'MODEL_TYPE|MODEL_PATH|DEFECT_CLASS'"
```

Esperado: `MODEL_TYPE=detection`, `MODEL_PATH=...09_02_2026_16_53...`, e as duas listas novas de classes.

- [ ] **Step 3: Acompanhar o startup (build do TensorRT)**

```bash
$VKSSH "docker logs --tail 60 visionking-inference 2>&1"
```

Esperado: carregamento do modelo, sem `NoClassDefFoundError`/traceback; pode aparecer build de engine TRT. Repetir o comando até ver `process_predictions_batch` processando batches (pode levar alguns minutos).

- [ ] **Step 4: Confirmar que a inferência voltou a detectar**

```bash
$VKSSH "docker logs --tail 1500 visionking-inference 2>&1 | grep -oE 'Applying rule engine to [0-9]+ detections' | sort | uniq -c"
```

Esperado: distribuição de frames com 0..N detecções (pipeline detectando normalmente).

**⛔ Gate de fase:** container `Up`, sem crash, processando batches.

---

## Fase 5 — Validação com barra real

### Task 5.1: Result-writer sem o erro de `position`

- [ ] **Step 1: Conferir que o erro de numeric parou**

```bash
$VKSSH "docker logs --since 5m visionking-result-writer 2>&1 | grep -c 'invalid input syntax for type numeric'"
```

Esperado: `0` (era >0 na linha de base da Task 0.1).

- [ ] **Step 2: Conferir sucesso de batch**

```bash
$VKSSH "docker logs --since 5m visionking-result-writer 2>&1 | grep -c 'processado com sucesso'"
```

Esperado: número > 0 e crescente.

### Task 5.2: `defeitos` voltando a gravar

- [ ] **Step 1: Contar defeitos recentes**

```bash
PSQL "SELECT COUNT(*) AS ultimos_10min, MAX(inserted_at) AS ultimo FROM defeitos WHERE inserted_at > now()-interval '10 minutes';"
```

Esperado: `ultimos_10min > 0` e `ultimo` ≈ agora (era 0 / 24-abr na linha de base).

- [ ] **Step 2: Distribuição por classe**

```bash
PSQL "SELECT d.class_id, c.defect_class_code, COUNT(*) FROM defeitos d JOIN classe_defeitos c ON c.id=d.class_id WHERE d.inserted_at > now()-interval '15 minutes' GROUP BY 1,2 ORDER BY 3 DESC;"
```

Esperado: aparecem `class_id` 2–10 conforme detecção; `risco_analise` (id 2) deve dominar (historicamente ~96%).

### Task 5.3: Sanidade do mapeamento

- [ ] **Step 1: `reflexo` não deve ser gravado** — nenhum `class_id` fora de {2..10}; `reflexo` não tem id ⇒ ausência implícita. Confirmar que não há `class_id` nulo ou inesperado:

```bash
PSQL "SELECT DISTINCT class_id FROM defeitos WHERE inserted_at > now()-interval '15 minutes' ORDER BY 1;"
```

Esperado: subconjunto de `{2,3,4,5,6,7,8,9,10}`. Nenhum `0` (FK) nem `NULL`.

- [ ] **Step 2: `carepa` (id 5) só deve aparecer em peças de corrida F–M**; `amasso` (id 6) só em câmeras 2/4/5. Validar amostralmente cruzando `defeitos`→`frames`:

```bash
PSQL "SELECT f.camera_id, COUNT(*) FROM defeitos d JOIN frames f ON f.frame_uuid=d.frame_uuid WHERE d.class_id=6 AND d.inserted_at>now()-interval '20 minutes' GROUP BY 1 ORDER BY 1;"
```

Esperado: `camera_id` apenas em {2,4,5} (filtro de amasso funcionando).

### Task 5.4: Visualizer

- [ ] **Step 1:** Abrir o visualizer (porta 80 do vk01, via VPN) e confirmar que defeitos novos aparecem desenhados sobre os frames, com as caixas no lugar certo.

Esperado: caixas de defeito renderizadas; sem regressão visual.

**⛔ Gate final:** apresentar ao Pedro o resumo — erro de `numeric` zerado, `defeitos` gravando, distribuição coerente. Encerrar ou acionar rollback.

---

## Rollback

Se qualquer fase falhar de forma irrecuperável:

```bash
# 1. Restaurar compose e rules.json
$VKSSH "cp /home/vk01/Downloads/visionking-inference-c017.yml.bak-2026-05-15 /home/vk01/Downloads/visionking-inference-c017.yml"
$VKSSH "cp /home/vk01/Downloads/rules/rules.json.bak-2026-05-15 /home/vk01/Downloads/rules/rules.json"
# 2. Recriar o container no estado anterior (OBB)
$VKSSH "cd /home/vk01/Downloads && docker-compose -f visionking-inference-c017.yml up -d"
# 3. Remover as linhas novas de classe_defeitos (seguro: sem defeitos referenciando-as no estado OBB)
PSQL "DELETE FROM classe_defeitos WHERE id IN (9,10);"
```

> O rollback volta ao estado pré-correção (OBB rodando, `defeitos` sem gravar) — é um retorno seguro, não uma solução. O modelo detection copiado em `/home/vk01/Downloads/models/detect/09_02_2026_16_53...` pode permanecer no disco (não atrapalha).

---

## Resumo de cobertura (self-review)

| Requisito | Tarefa |
|---|---|
| Destravar gravação de defeitos (bug `position` OBB) | Fase 2 + Fase 4 (troca p/ detection) |
| `DEFECT_CLASSES` alinhado ao modelo novo | Task 4.1 |
| `DEFECT_CLASS_MAPPING` alinhado (nome→id) | Task 4.1 |
| `rules.json` com nomes crus + filtro amasso + split carepa | Fase 3 |
| Split `po_flux`/`carepa` por região da corrida | Task 3.1 (regra 2) |
| Filtro de amasso por câmera mantido | Task 3.1 (regra 1) |
| Persistir trinca, risco_aprova | Task 4.1 (já em `classe_defeitos`) |
| Persistir farpa, mancha | Fase 1 + Task 4.1 |
| `reflexo` descartado | Ausência em `DEFECT_CLASSES` (Task 4.1) |
| Backups + rollback | Fase 0 + seção Rollback |
| Validação com barra real | Fase 5 |

**Pontos que exigem confirmação humana antes/durante a execução:**
1. `classe_defeitos` — `category_code`/`group_name`/`aggregation` de farpa e mancha (engenharia/Vanessa) — Task 1.1.
2. Janela de execução da Fase 4 (parada curta da inferência + build TRT).
3. `THRESHOLD_PRED=0.15` foi mantido do OBB — pode ser reajustado para o modelo detection após observar a Fase 5 (fora do escopo deste plano).
