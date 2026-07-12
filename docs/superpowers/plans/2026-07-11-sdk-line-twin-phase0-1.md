---
type: Implementation Plan
title: sdk-line-twin — Fases 0–1 (scaffold, parser L5X, tag DB, interpretador RLL+ST, plant de eixos, regressão jog/homing)
description: Plano de implementação das Fases 0–1 do sdk-line-twin — repo novo, parser L5X, tag database bytes-backed, interpretador RLL+ST subset com falha ruidosa, modelo de drive CiA-402 e suíte pytest de regressão do Servo v5 (jog/homing) em pure-sim.
tags: [line-twin, plc, l5x, simulacao, iris, rockwell]
timestamp: 2026-07-11
project: "03007"
product: visionking
language: pt-BR
status: draft
---

# sdk-line-twin Fases 0–1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repo `sdk-line-twin` funcional em pure-sim: carrega os L5X reais do IRIS v5, executa a lógica RLL+ST em scan Logix emulado contra um modelo de eixos CiA-402, e roda regressão pytest de jog/homing.

**Architecture:** Pacote Python `sim_core` headless (sem Redis/browser nesta fase): `logix/` (parser L5X + tag DB bytes-backed + executores RLL e ST + controlador com scan loop), `plant/` (drive CiA-402 + iomap por assembly), `SimSession` como fachada de testes. Perfil `profiles/iris-03007/` carrega cópias dos L5X/CSV reais do pmo (com proveniência).

**Tech Stack:** Python 3.12, stdlib `xml.etree` para L5X, pytest. Zero dependências de runtime na Fase 0–1 (YAML/Redis/pylogix entram em fases posteriores).

**Spec:** `docs/superpowers/specs/2026-07-11-sdk-line-twin-design.md`

## Global Constraints

- Repo local: `~/JARVIS/workspaces/strokmatic/sdk/sdk-line-twin`; branch de trabalho `feat/v1` (push inicial nunca em `master` — classifier bloqueia; rename via `gh api` depois).
- Python via venv local (`python3 -m venv .venv`); nunca instalar no sistema.
- **Falha ruidosa**: instrução/datatype/rotina não suportada ⇒ erro agregado no load (`LoadError` com a lista completa), jamais skip silencioso.
- **Perfil ≠ engine**: nada com nome IRIS/03007 dentro de `sim_core/`; tudo específico vive em `profiles/iris-03007/`.
- Timers e física avançam SOMENTE pelo clock simulado (passo fixo default 10 ms) — nunca wall-clock.
- Artefatos L5X de referência (fonte SSOT no pmo 03007):
  - `~/JARVIS/workspaces/strokmatic/pmo/projects/03007/handoffs/2026.07.11_update-jog-homing/` → `Servo_Program.L5X` (MainServo RLL + Servo1–4 ST), `R030_ManualMotion_Routine.L5X`, `R031_Homing_Routine.L5X`, `R003_Faults_Routine.L5X`, `new-controller-tags.CSV`
  - `~/JARVIS/workspaces/strokmatic/pmo/projects/03007/plc/2026.07.11_programa-plc-rockwell-r2/MainProgram_Program.L5X` (RLL+ST+FBD — FBD é exclusão de perfil)
- Layout dos assemblies do gateway (ground truth dos COPs do Servo v5): entrada `COP(AnyBusComm:I.Data[k], ServoN_In, 1)` com k = 0/21/42/63; saída `COP(ServoN_Out, AnyBusComm:O.Data[m], 8)` com m = 0/8/16/24. `AnyBusComm:I.Data` e `:O.Data` são arrays de SINT.
- Commits frequentes, mensagens `feat:/test:/chore:` convencionais, co-author `Claude Fable 5 <noreply@anthropic.com>`.

## File Structure (final da Fase 1)

```
sdk-line-twin/
├── pyproject.toml
├── README.md
├── .gitignore
├── sim_core/
│   ├── __init__.py
│   ├── clock.py               # SimClock passo fixo
│   ├── errors.py              # LoadError (agregado), MajorFault
│   └── logix/
│   │   ├── __init__.py
│   │   ├── datatypes.py       # escalares, UDTs, layout de bytes Logix
│   │   ├── tagdb.py           # tags bytes-backed, paths (Tag.M[2].3), módulos
│   │   ├── l5x_parser.py      # L5X → modelo (programas, rotinas, tags, UDTs)
│   │   ├── csv_tags.py        # CSV Studio 5000 → tag defs
│   │   ├── rll.py             # parser + executor de rungs (texto neutro)
│   │   ├── st.py              # tokenizer + parser + executor ST subset
│   │   ├── instructions.py    # semântica compartilhada (MOV/COP/TON/…)
│   │   └── controller.py      # scan loop, prescan, S:FS, JSR, faults, validação
│   ├── plant/
│   │   ├── __init__.py
│   │   ├── drive.py           # drive CiA-402 (PP/PV, halt, probe, rampa)
│   │   └── iomap.py           # liga bytes do drive ↔ tags de módulo do controlador
│   └── session.py             # SimSession: load perfil, run, poke/read
├── profiles/iris-03007/
│   ├── PROVENANCE.md          # de onde vieram os L5X/CSV (caminhos pmo + data)
│   ├── l5x/                   # cópias dos artefatos listados acima
│   ├── profile.yaml           # (Fase 1: JSON simples profile.json — YAML entra depois)
│   └── plant.json             # parâmetros físicos por eixo
└── tests/
    ├── test_datatypes.py
    ├── test_tagdb.py
    ├── test_l5x_parser.py
    ├── test_csv_tags.py
    ├── test_rll.py
    ├── test_st.py
    ├── test_instructions.py
    ├── test_controller.py
    ├── test_drive.py
    └── regression/
        └── test_jog_homing.py
```

Responsabilidades: cada módulo é importável e testável sozinho; `controller.py` não conhece `plant/` (recebe callbacks de I/O); `plant/` não conhece L5X (fala bytes). `session.py` é o único que junta tudo.

---

### Task 0: Scaffold do repo + perfil com artefatos reais

**Files:**
- Create: `pyproject.toml`, `.gitignore`, `README.md`, `sim_core/__init__.py`, `tests/test_smoke.py`
- Create: `profiles/iris-03007/PROVENANCE.md` + cópias em `profiles/iris-03007/l5x/`

**Interfaces:**
- Produces: repo git em `feat/v1`, venv, `pytest` verde, artefatos L5X/CSV disponíveis em `profiles/iris-03007/l5x/` para todas as tasks seguintes.

- [ ] **Step 1: criar repo, venv e esqueleto**

```bash
mkdir -p ~/JARVIS/workspaces/strokmatic/sdk/sdk-line-twin && cd $_
git init -b feat/v1
python3 -m venv .venv && .venv/bin/pip install -U pip pytest
mkdir -p sim_core/logix sim_core/plant tests profiles/iris-03007/l5x
touch sim_core/__init__.py sim_core/logix/__init__.py sim_core/plant/__init__.py
```

`pyproject.toml`:

```toml
[project]
name = "sim-core"
version = "0.1.0"
description = "sdk-line-twin — digital line twin + Logix L5X interpreter"
requires-python = ">=3.12"

[tool.pytest.ini_options]
testpaths = ["tests"]
```

`.gitignore`:

```
.venv/
__pycache__/
*.pyc
.pytest_cache/
```

`README.md` (curto): título, 1 parágrafo do objetivo, link ao spec no JARVIS, `how to run: .venv/bin/pytest`.

- [ ] **Step 2: smoke test**

`tests/test_smoke.py`:

```python
def test_imports():
    import sim_core  # noqa: F401
```

Run: `.venv/bin/pytest -q` → Expected: `1 passed`

- [ ] **Step 3: copiar artefatos reais + proveniência**

```bash
P=~/JARVIS/workspaces/strokmatic/pmo/projects/03007
cp $P/handoffs/2026.07.11_update-jog-homing/{Servo_Program.L5X,R030_ManualMotion_Routine.L5X,R031_Homing_Routine.L5X,R003_Faults_Routine.L5X,new-controller-tags.CSV} profiles/iris-03007/l5x/
cp $P/plc/2026.07.11_programa-plc-rockwell-r2/MainProgram_Program.L5X profiles/iris-03007/l5x/
```

`profiles/iris-03007/PROVENANCE.md`: tabela arquivo → caminho de origem no pmo → data (2026-07-11) → versão do contrato (v0.99.8). Nota: SSOT é o pmo; ao atualizar o programa, recopiar e registrar aqui.

- [ ] **Step 4: commit**

```bash
git add -A && git commit -m "chore: scaffold sim-core + perfil iris-03007 com L5X v5 reais"
```

---

### Task 1: `datatypes.py` — tipos escalares e layout de UDT

**Files:**
- Create: `sim_core/logix/datatypes.py`
- Test: `tests/test_datatypes.py`

**Interfaces:**
- Produces:
  - `SCALAR_SIZES: dict[str, int]` — `{"BOOL":1,"SINT":1,"INT":2,"DINT":4,"REAL":4}` (BOOL ocupa 1 byte quando standalone)
  - `@dataclass Member(name: str, dtype: str, dim: int = 0)` · `@dataclass UdtDef(name: str, members: list[Member])`
  - `layout(udt: UdtDef, udts: dict[str, UdtDef]) -> list[FieldSlot]` com `FieldSlot(name, dtype, offset, bit, dim)`
  - `size_of(dtype: str, udts: dict) -> int`
- Regras de packing (subset Logix, validável depois por golden test no L19ER): alinhamento por tipo (SINT:1, INT:2, DINT/REAL/UDT:4); BOOLs consecutivos compartilham bytes (8/byte, host alinhado a 1); arrays = n × size elemento (elemento alinhado); tamanho final do UDT arredondado para múltiplo de 4.

- [ ] **Step 1: teste falhando**

```python
from sim_core.logix.datatypes import Member, UdtDef, layout, size_of

def test_scalar_sizes():
    assert size_of("DINT", {}) == 4 and size_of("INT", {}) == 2

def test_udt_layout_padding_and_bools():
    u = UdtDef("U", [Member("a", "BOOL"), Member("b", "BOOL"),
                     Member("c", "INT"), Member("d", "DINT"), Member("e", "SINT")])
    slots = {s.name: s for s in layout(u, {})}
    assert (slots["a"].offset, slots["a"].bit) == (0, 0)
    assert (slots["b"].offset, slots["b"].bit) == (0, 1)
    assert slots["c"].offset == 2          # INT alinha em 2
    assert slots["d"].offset == 4          # DINT alinha em 4
    assert slots["e"].offset == 8
    assert size_of("U", {"U": u}) == 12    # 9 → arredonda p/ múltiplo de 4

def test_udt_array_member():
    u = UdtDef("V", [Member("opts", "INT", dim=8), Member("vid", "DINT")])
    slots = {s.name: s for s in layout(u, {})}
    assert slots["opts"].offset == 0 and slots["vid"].offset == 16
    assert size_of("V", {"V": u}) == 20
```

- [ ] **Step 2:** Run `.venv/bin/pytest tests/test_datatypes.py -q` → FAIL (module not found)

- [ ] **Step 3: implementação**

```python
from dataclasses import dataclass, field

SCALAR_SIZES = {"BOOL": 1, "SINT": 1, "INT": 2, "DINT": 4, "REAL": 4}
ALIGN = {"BOOL": 1, "SINT": 1, "INT": 2, "DINT": 4, "REAL": 4}

@dataclass
class Member:
    name: str
    dtype: str
    dim: int = 0

@dataclass
class UdtDef:
    name: str
    members: list[Member] = field(default_factory=list)

@dataclass
class FieldSlot:
    name: str
    dtype: str
    offset: int
    bit: int | None = None
    dim: int = 0

def _align(off: int, a: int) -> int:
    return (off + a - 1) // a * a

def size_of(dtype: str, udts: dict) -> int:
    if dtype in SCALAR_SIZES:
        return SCALAR_SIZES[dtype]
    u = udts[dtype]
    return _layout_size(u, udts)[1]

def _elem_align(dtype: str) -> int:
    return ALIGN.get(dtype, 4)

def _layout_size(udt: UdtDef, udts: dict) -> tuple[list[FieldSlot], int]:
    slots, off, bitpos = [], 0, None  # bitpos = (byte_offset, next_bit)
    for m in udt.members:
        if m.dtype == "BOOL" and m.dim == 0:
            if bitpos is None or bitpos[1] == 8:
                off = _align(off, 1)
                bitpos = (off, 0)
                off += 1
            slots.append(FieldSlot(m.name, "BOOL", bitpos[0], bitpos[1]))
            bitpos = (bitpos[0], bitpos[1] + 1)
            continue
        bitpos = None
        a = _elem_align(m.dtype)
        off = _align(off, a)
        slots.append(FieldSlot(m.name, m.dtype, off, None, m.dim))
        n = max(m.dim, 1)
        off += n * size_of(m.dtype, udts)
    return slots, _align(off, 4)

def layout(udt: UdtDef, udts: dict) -> list[FieldSlot]:
    return _layout_size(udt, udts)[0]
```

- [ ] **Step 4:** Run `.venv/bin/pytest tests/test_datatypes.py -q` → PASS
- [ ] **Step 5:** `git add -A && git commit -m "feat(logix): datatypes — escalares + layout de UDT com packing Logix"`

---

### Task 2: `tagdb.py` — tags bytes-backed e resolução de paths

**Files:**
- Create: `sim_core/logix/tagdb.py`
- Test: `tests/test_tagdb.py`

**Interfaces:**
- Consumes: `datatypes.layout/size_of/UdtDef/Member`
- Produces:
  - `class TagDb(udts: dict[str, UdtDef])`
  - `.create(name: str, dtype: str, dim: int = 0)` — cria tag zerada (bytes). Aceita nomes de módulo com `:` (ex.: `AnyBusComm:I`) como tags comuns.
  - `.get(path: str) -> int | float | list` · `.set(path: str, value)` — paths: `Tag`, `Tag.Member`, `Tag[2]`, `Tag.M[2].Sub`, bit-of-word `Tag.3` / `Tag.M.15`; BOOL retorna 0/1.
  - `.raw(name: str) -> bytearray` — buffer inteiro da tag (para COP e iomap)
  - `.exists(path: str) -> bool` · `.dtype_of(path: str) -> str`
- Encoding: little-endian; SINT/INT/DINT signed; REAL float32. Escrita satura via truncamento estilo Logix (`int & mask` com sign-extend).

- [ ] **Step 1: teste falhando**

```python
import pytest
from sim_core.logix.datatypes import Member, UdtDef
from sim_core.logix.tagdb import TagDb

UDTS = {"Pt": UdtDef("Pt", [Member("x", "DINT"), Member("ok", "BOOL")]),
        "Job": UdtDef("Job", [Member("opts", "INT", dim=8), Member("pt", "Pt")])}

def db():
    d = TagDb(UDTS)
    d.create("Count", "DINT")
    d.create("Buf", "SINT", dim=32)
    d.create("J", "Job")
    d.create("AnyBusComm:I", "SINT", dim=128)
    return d

def test_scalar_roundtrip():
    d = db(); d.set("Count", -5)
    assert d.get("Count") == -5

def test_array_and_member_paths():
    d = db()
    d.set("J.opts[3]", 77); d.set("J.pt.x", 123); d.set("J.pt.ok", 1)
    assert d.get("J.opts[3]") == 77 and d.get("J.pt.x") == 123 and d.get("J.pt.ok") == 1

def test_bit_of_word():
    d = db(); d.set("Count", 0); d.set("Count.3", 1)
    assert d.get("Count") == 8 and d.get("Count.3") == 1

def test_module_tag_bytes():
    d = db(); d.set("AnyBusComm:I[2]", -1)
    assert d.raw("AnyBusComm:I")[2] == 0xFF

def test_unknown_path_raises():
    with pytest.raises(KeyError):
        db().get("Nope.x")
```

- [ ] **Step 2:** Run → FAIL
- [ ] **Step 3: implementação** — pontos obrigatórios (código completo):

```python
import re
import struct
from .datatypes import SCALAR_SIZES, UdtDef, layout, size_of

_TOKEN = re.compile(r"([A-Za-z_][A-Za-z0-9_:]*)|\[(\d+)\]|\.(\d+)$|\.([A-Za-z_][A-Za-z0-9_]*)")

def _decode(buf, off, dtype):
    if dtype == "SINT": return struct.unpack_from("<b", buf, off)[0]
    if dtype == "INT":  return struct.unpack_from("<h", buf, off)[0]
    if dtype == "DINT": return struct.unpack_from("<i", buf, off)[0]
    if dtype == "REAL": return struct.unpack_from("<f", buf, off)[0]
    raise KeyError(dtype)

def _encode(buf, off, dtype, val):
    if dtype == "REAL":
        struct.pack_into("<f", buf, off, float(val)); return
    bits = {"SINT": 8, "INT": 16, "DINT": 32}[dtype]
    v = int(val) & ((1 << bits) - 1)
    if v >= 1 << (bits - 1): v -= 1 << bits
    struct.pack_into({"SINT": "<b", "INT": "<h", "DINT": "<i"}[dtype], buf, off, v)

class TagDb:
    def __init__(self, udts: dict[str, UdtDef]):
        self.udts = udts
        self.tags: dict[str, tuple[str, int, bytearray]] = {}  # name → (dtype, dim, buf)

    def create(self, name, dtype, dim=0):
        n = max(dim, 1)
        self.tags[name] = (dtype, dim, bytearray(n * size_of(dtype, self.udts)))

    def raw(self, name):  return self.tags[name][2]
    def exists(self, path):
        try: self._resolve(path); return True
        except KeyError: return False
    def dtype_of(self, path): return self._resolve(path)[1]

    def _resolve(self, path):
        # → (buf, dtype, offset, bit|None)
        parts = path.split(".")
        head = parts[0]
        m = re.match(r"([^\[]+)(?:\[(\d+)\])?$", head)
        name, idx = m.group(1), m.group(2)
        if name not in self.tags: raise KeyError(name)
        dtype, dim, buf = self.tags[name]
        off = int(idx or 0) * size_of(dtype, self.udts)
        bit = None
        for p in parts[1:]:
            if p.isdigit():                      # bit-of-word
                bit = int(p); break
            m = re.match(r"([^\[]+)(?:\[(\d+)\])?$", p)
            mem, midx = m.group(1), m.group(2)
            slots = {s.name: s for s in layout(self.udts[dtype], self.udts)}
            if mem not in slots: raise KeyError(path)
            s = slots[mem]
            off += s.offset + int(midx or 0) * size_of(s.dtype, self.udts)
            if s.bit is not None: bit = s.bit
            dtype = s.dtype
        return buf, dtype, off, bit

    def get(self, path):
        buf, dtype, off, bit = self._resolve(path)
        if dtype == "BOOL" or bit is not None:
            b = bit or 0
            if dtype != "BOOL" and bit is not None:      # bit-of-word em inteiro
                width = SCALAR_SIZES[dtype]
                word = int.from_bytes(buf[off:off+width], "little")
                return (word >> bit) & 1
            return (buf[off] >> b) & 1
        return _decode(buf, off, dtype)

    def set(self, path, value):
        buf, dtype, off, bit = self._resolve(path)
        if dtype == "BOOL" or bit is not None:
            b = bit or 0
            if dtype != "BOOL" and bit is not None:
                byte_off = off + b // 8; b %= 8
            else:
                byte_off = off
            if int(value): buf[byte_off] |= (1 << b)
            else:          buf[byte_off] &= ~(1 << b) & 0xFF
            return
        _encode(buf, off, dtype, value)
```

(BOOL standalone: dtype "BOOL" com `SCALAR_SIZES["BOOL"]=1`, bit default 0.)

- [ ] **Step 4:** Run `.venv/bin/pytest tests/test_tagdb.py -q` → PASS
- [ ] **Step 5:** `git add -A && git commit -m "feat(logix): TagDb bytes-backed com paths, bit-of-word e tags de módulo"`

---

### Task 3: `l5x_parser.py` — L5X real → modelo

**Files:**
- Create: `sim_core/logix/l5x_parser.py`
- Test: `tests/test_l5x_parser.py`

**Interfaces:**
- Consumes: arquivos em `profiles/iris-03007/l5x/`
- Produces:
  - `parse_l5x(path) -> L5xDoc` com:
    - `.udts: dict[str, UdtDef]` (de `<DataType>`; membros `Hidden="true"` de hosts de BOOL são pulados e BOOLs mapeados por `Target`/`BitNumber` — se presente — senão em ordem)
    - `.tags: list[TagDecl(name, dtype, dim, scope)]` (controller + program scope; decodifica atributos `DataType`, `Dimensions`)
    - `.programs: dict[str, ProgramDef]`; `ProgramDef.routines: dict[str, RoutineDef]`; `RoutineDef(name, lang ∈ {"RLL","ST","FBD"}, rungs: list[str] | st_lines: list[str])` — rungs de `<Rung><Text><![CDATA[...]]></Text>`, ST de `<STContent><Line><![CDATA[...]]>` concatenado com `\n`; comentários `//` preservados (o executor ignora)
    - `.main_routine: str | None` (atributo `MainRoutineName` do `<Program>`)
  - Suporta os três formatos de export: programa (`TargetType="Program"`), rotina avulsa (`TargetType="Routine"`), UDT avulso (`TargetType="DataType"`).

- [ ] **Step 1: teste falhando (contra os arquivos reais)**

```python
from pathlib import Path
from sim_core.logix.l5x_parser import parse_l5x

L5X = Path("profiles/iris-03007/l5x")

def test_servo_program_structure():
    doc = parse_l5x(L5X / "Servo_Program.L5X")
    prog = doc.programs["Servo_Program"]
    assert prog.routines["MainServo"].lang == "RLL"
    assert [prog.routines[f"Servo{i}"].lang for i in (1, 2, 3, 4)] == ["ST"] * 4
    assert any("JSR" in r for r in prog.routines["MainServo"].rungs)
    assert "COP(AnyBusComm:I.Data[0], Servo1_In, 1)" in "\n".join(
        prog.routines["Servo1"].st_lines)

def test_mainprogram_has_fbd_marked():
    doc = parse_l5x(L5X / "MainProgram_Program.L5X")
    prog = doc.programs["MainProgram"]
    assert prog.routines["R100_PID_R1"].lang == "FBD"
    assert prog.routines["MainRoutine"].lang == "RLL"

def test_single_routine_export():
    doc = parse_l5x(L5X / "R030_ManualMotion_Routine.L5X")
    (r,) = [rt for p in doc.programs.values() for rt in p.routines.values()]
    assert r.lang == "ST" and any(":=" in l for l in r.st_lines)

def test_udts_extracted():
    doc = parse_l5x(L5X / "Servo_Program.L5X")
    assert any(u for u in doc.udts)          # UDTs Servo*_In/Out presentes ou vazio se export não os inclui
```

Nota: o último assert será ajustado no Step 2 conforme o conteúdo real (se o export de programa não embute `<DataTypes>`, os UDTs virão do MainProgram ou de UDT_*.L5X — verificar com `grep -c "<DataType " *.L5X` e fixar o teste no fato real).

- [ ] **Step 2:** Run → FAIL; inspecionar os L5X reais (`grep -o '<DataType [^>]*Name="[^"]*"' profiles/iris-03007/l5x/*.L5X | sort -u`) e ajustar o teste de UDT ao fato observado (sem enfraquecê-lo: fixar nomes concretos encontrados).

- [ ] **Step 3: implementação** — `xml.etree.ElementTree`; núcleo:

```python
from dataclasses import dataclass, field
from pathlib import Path
import xml.etree.ElementTree as ET
from .datatypes import Member, UdtDef

@dataclass
class TagDecl:
    name: str; dtype: str; dim: int = 0; scope: str = "controller"

@dataclass
class RoutineDef:
    name: str; lang: str
    rungs: list[str] = field(default_factory=list)
    st_lines: list[str] = field(default_factory=list)

@dataclass
class ProgramDef:
    name: str
    routines: dict[str, RoutineDef] = field(default_factory=dict)
    tags: list[TagDecl] = field(default_factory=list)
    main_routine: str | None = None

@dataclass
class L5xDoc:
    udts: dict[str, UdtDef] = field(default_factory=dict)
    tags: list[TagDecl] = field(default_factory=list)
    programs: dict[str, ProgramDef] = field(default_factory=dict)

def _dims(attr: str | None) -> int:
    return int(attr.split(" ")[0]) if attr else 0

def _parse_udt(el) -> UdtDef:
    members = []
    for m in el.iter("Member"):
        if m.get("Hidden") == "true":
            continue
        members.append(Member(m.get("Name"), m.get("DataType"),
                              _dims(m.get("Dimension"))))
    return UdtDef(el.get("Name"), members)

def _parse_routine(el) -> RoutineDef:
    lang = el.get("Type")
    r = RoutineDef(el.get("Name"), lang)
    if lang == "RLL":
        for rung in el.iter("Rung"):
            t = rung.find("Text")
            if t is not None and t.text:
                r.rungs.append(t.text.strip())
    elif lang == "ST":
        for line in el.iter("Line"):
            r.st_lines.append((line.text or "").rstrip())
    return r

def parse_l5x(path: str | Path) -> L5xDoc:
    root = ET.parse(path).getroot()
    doc = L5xDoc()
    for dt in root.iter("DataType"):
        u = _parse_udt(dt)
        doc.udts[u.name] = u
    for prog_el in root.iter("Program"):
        prog = ProgramDef(prog_el.get("Name"),
                          main_routine=prog_el.get("MainRoutineName"))
        for tag in prog_el.iter("Tag"):
            prog.tags.append(TagDecl(tag.get("Name"), tag.get("DataType"),
                                     _dims(tag.get("Dimensions")), "program"))
        for rt in prog_el.iter("Routine"):
            prog.routines[rt.get("Name")] = _parse_routine(rt)
        doc.programs[prog.name] = prog
    ctrl = root.find(".//Controller")
    if ctrl is not None:
        tags_el = ctrl.find("Tags")
        if tags_el is not None:
            for tag in tags_el.findall("Tag"):
                doc.tags.append(TagDecl(tag.get("Name"), tag.get("DataType"),
                                        _dims(tag.get("Dimensions"))))
    # export de rotina avulsa: Routine fora de Program
    if not doc.programs:
        for rt in root.iter("Routine"):
            p = doc.programs.setdefault("_standalone", ProgramDef("_standalone"))
            p.routines[rt.get("Name")] = _parse_routine(rt)
    return doc
```

Cuidado real: CDATA de `<Line>` vem como `.text` já decodificado pelo ElementTree; rungs multi-linha idem.

- [ ] **Step 4:** Run → PASS (contra os 3+ arquivos reais)
- [ ] **Step 5:** `git add -A && git commit -m "feat(logix): parser L5X — programas, rotinas RLL/ST/FBD, tags, UDTs (testado nos exports reais do 03007)"`

---

### Task 4: `csv_tags.py` — import do CSV Studio 5000

**Files:**
- Create: `sim_core/logix/csv_tags.py`
- Test: `tests/test_csv_tags.py`

**Interfaces:**
- Consumes: `profiles/iris-03007/l5x/new-controller-tags.CSV`
- Produces: `parse_tags_csv(path) -> list[TagDecl]` — formato Studio 5000 (`;`-separado, linhas `remark;...` e linha de versão `0.3` ignoradas; linhas com col0 `TAG`/`ALIAS` viram TagDecl; `Dimensions` extraído do specifier `NAME[n]` quando presente).

- [ ] **Step 1: teste falhando**

```python
from pathlib import Path
from sim_core.logix.csv_tags import parse_tags_csv

def test_real_csv_parses_and_has_v5_tags():
    tags = parse_tags_csv(Path("profiles/iris-03007/l5x/new-controller-tags.CSV"))
    names = {t.name for t in tags}
    assert len(tags) >= 30                      # pacote v5 = 34 tags
    assert any("Jog" in n or "Home" in n or "Homing" in n for n in names)
    assert all(t.dtype for t in tags)
```

- [ ] **Step 2:** Run → FAIL. Abrir o CSV real (`head -12 profiles/iris-03007/l5x/new-controller-tags.CSV`), anotar as colunas exatas no docstring do módulo, e SE os asserts acima não casarem com o conteúdo real (ex.: nomes sem "Jog"), corrigir o teste para nomes concretos do arquivo (ex.: `WSCmd_JogStep`) antes de implementar.
- [ ] **Step 3: implementação** — leitura com `csv.reader(delimiter=";")`, skip de `remark` e linha de versão; mapear colunas conforme anotado; TYPE `ALIAS` gera TagDecl com `dtype` do alvo se derivável, senão registra em `doc.aliases` (dict name→target) exposto no retorno como segundo elemento: assinatura final `parse_tags_csv(path) -> tuple[list[TagDecl], dict[str, str]]` (ajustar teste).
- [ ] **Step 4:** Run → PASS
- [ ] **Step 5:** `git add -A && git commit -m "feat(logix): import de tags CSV Studio 5000 (34 tags v5 reais)"`

---

### Task 5: `rll.py` parser — texto neutro → AST

**Files:**
- Create: `sim_core/logix/rll.py` (parte 1: parser)
- Test: `tests/test_rll.py`

**Interfaces:**
- Produces:
  - `parse_rung(text: str) -> Seq` — AST: `Seq(items: list[Instr | Branch])`, `Branch(legs: list[Seq])`, `Instr(op: str, args: list[str])`
  - Gramática: `rung := seq ';'` · `branch := '[' seq (',' seq)* ']'` · `instr := NAME '(' args ')'`; args separados por vírgula fora de parênteses/colchetes internos; espaços/quebras ignorados; `?` aceito como arg literal (placeholders de display do TON).

- [ ] **Step 1: teste falhando**

```python
from sim_core.logix.rll import parse_rung, Instr, Branch

def test_series():
    s = parse_rung("XIC(A)XIO(B)OTE(C);")
    assert [i.op for i in s.items] == ["XIC", "XIO", "OTE"]

def test_branch_two_legs():
    s = parse_rung("XIC(A)[XIC(B),XIC(C)XIO(D)]OTE(E);")
    br = s.items[1]
    assert isinstance(br, Branch) and len(br.legs) == 2
    assert [i.op for i in br.legs[1].items] == ["XIC", "XIO"]

def test_args_with_brackets_and_placeholders():
    s = parse_rung("COP(AnyBusComm:I.Data[0],Servo1_In,1)TON(T1,?,?);")
    assert s.items[0].args == ["AnyBusComm:I.Data[0]", "Servo1_In", "1"]
    assert s.items[1].args == ["T1", "?", "?"]

def test_real_mainservo_rungs_parse():
    from pathlib import Path
    from sim_core.logix.l5x_parser import parse_l5x
    doc = parse_l5x(Path("profiles/iris-03007/l5x/Servo_Program.L5X"))
    for rung in doc.programs["Servo_Program"].routines["MainServo"].rungs:
        parse_rung(rung)   # não pode levantar
```

- [ ] **Step 2:** Run → FAIL
- [ ] **Step 3: implementação** — scanner manual char-a-char (índice), sem regex para a estrutura: funções `_seq(s, i)`, `_branch(s, i)`, `_instr(s, i)`, `_args(s, i)` (contador de profundidade para `[`/`(` dentro de args). Comentários de rung não existem no texto neutro (vivem em `<Comment>`) — não tratar.
- [ ] **Step 4:** Run → PASS (inclusive contra todos os rungs reais do MainServo)
- [ ] **Step 5:** `git add -A && git commit -m "feat(logix): parser de rungs RLL (texto neutro) validado nos rungs reais"`

---

### Task 6: `instructions.py` + executor RLL — semântica de bits e palavras

**Files:**
- Create: `sim_core/logix/instructions.py`
- Modify: `sim_core/logix/rll.py` (parte 2: `exec_rung`)
- Test: `tests/test_instructions.py`, ampliar `tests/test_rll.py`

**Interfaces:**
- Consumes: `TagDb`, AST da Task 5
- Produces:
  - `class ExecCtx(db: TagDb, clock: SimClock, controller)` — `controller` dá acesso a JSR (Task 8) e fault
  - `exec_rung(seq: Seq, ctx: ExecCtx) -> None` — semântica rung-condition: instruções de entrada (XIC/XIO/comparações) AND-am a condição; Branch = OR dos legs (cada leg avaliado com a condição de entrada do branch); instruções de saída executam/limpam conforme condição
  - Registry `INSTRUCTIONS: dict[str, InstrDef]` com `kind ∈ {"input","output"}` e `fn(ctx, cond, args) -> bool` (retorna condição de saída)
  - Aliases: `MOVE→MOV`, `GT→GRT`, `GE→GEQ`, `EQ→EQU`, `LT→LES`, `LE→LEQ`, `NE→NEQ`
  - Subset (RLL): `XIC XIO OTE OTL OTU ONS TON TOF TONR TOFR RES MOV COP CPS FLL JSR RET EQU NEQ GRT LES GEQ LEQ LIM ADD SUB MUL DIV BTD CLR NOP AFI MSG`
  - Semânticas críticas:
    - `ONS(bit)`: cond_out = cond_in AND NOT stored; stored := cond_in
    - `TON(t,?,?)`: se cond_in: `.EN=1`, `.ACC += clock.dt_ms` até `.PRE`, `.DN = ACC>=PRE`; senão zera `.EN/.ACC/.DN`. Timer é UDT `TIMER` builtin (PRE/ACC DINT, EN/TT/DN BOOL) registrado no TagDb pelo controller.
    - `COP(src,dst,len)`: cópia RAW de bytes — `len` × size_of(elemento de dst) bytes de `raw(src)+off(src)` para `raw(dst)+off(dst)` (é assim que o v5 move assemblies; o teste replica o COP real de 8 bytes SINT)
    - `MOV(a,b)`: converte numérico com truncamento p/ tipo de destino
    - `MSG(m)`: stub — loga `warning` uma vez por tag e seta `m.DN`
  - Numéricos: operandos são paths OU literais (`1`, `-3.5`, `2#0101`? — só decimal no v1; hex/binário ⇒ LoadError)

- [ ] **Step 1: testes falhando (núcleo)**

```python
from sim_core.clock import SimClock
from sim_core.logix.tagdb import TagDb
from sim_core.logix.rll import parse_rung, exec_rung
from sim_core.logix.instructions import ExecCtx
from sim_core.logix.datatypes import UdtDef, Member

def ctx():
    db = TagDb({"TIMER": UdtDef("TIMER", [Member("PRE","DINT"),Member("ACC","DINT"),
                Member("EN","BOOL"),Member("TT","BOOL"),Member("DN","BOOL")])})
    for n in "ABCDE": db.create(n, "BOOL")
    db.create("T1", "TIMER"); db.create("N1", "DINT"); db.create("N2", "DINT")
    return ExecCtx(db, SimClock(dt_ms=10), None)

def run(c, text): exec_rung(parse_rung(text), c)

def test_xic_ote():
    c = ctx(); c.db.set("A", 1); run(c, "XIC(A)OTE(B);")
    assert c.db.get("B") == 1
    c.db.set("A", 0); run(c, "XIC(A)OTE(B);")
    assert c.db.get("B") == 0

def test_branch_or():
    c = ctx(); c.db.set("B", 1); run(c, "[XIC(A),XIC(B)]OTE(C);")
    assert c.db.get("C") == 1

def test_otl_otu_latch():
    c = ctx(); c.db.set("A", 1); run(c, "XIC(A)OTL(B);")
    c.db.set("A", 0); run(c, "XIC(A)OTL(B);")
    assert c.db.get("B") == 1
    c.db.set("A", 1); run(c, "XIC(A)OTU(B);")
    assert c.db.get("B") == 0

def test_ton_advances_with_sim_clock():
    c = ctx(); c.db.set("T1.PRE", 30); c.db.set("A", 1)
    for _ in range(3):
        run(c, "XIC(A)TON(T1,?,?);"); c.clock.tick()
    assert c.db.get("T1.DN") == 1 and c.db.get("T1.ACC") == 30

def test_mov_and_compare_alias():
    c = ctx(); run(c, "MOVE(41,N1);")          # alias real dos exports
    run(c, "GT(N1,40)OTE(D);")                  # alias GT→GRT
    assert c.db.get("N1") == 41 and c.db.get("D") == 1

def test_cop_raw_bytes():
    c = ctx(); c.db.create("Src", "SINT", dim=8); c.db.create("Dst", "SINT", dim=8)
    c.db.set("Src[0]", -1); run(c, "COP(Src,Dst,8);")
    assert c.db.raw("Dst")[0] == 0xFF
```

- [ ] **Step 2:** Run → FAIL
- [ ] **Step 3: implementação** — `SimClock` em `sim_core/clock.py` (`dt_ms`, `.now_ms`, `.tick()`); registry com dataclass `InstrDef(kind, fn)`; `exec_rung` percorre `Seq` mantendo `cond`; para `Branch`: `cond_out = any(_run_seq(leg, ctx, cond_in) for leg todos avaliados)` — **todos os legs sempre avaliados** (outputs em legs executam com sua própria condição), sem short-circuit.
- [ ] **Step 4:** Run → PASS
- [ ] **Step 5:** `git add -A && git commit -m "feat(logix): executor RLL + registry de instruções (bits, timers sim-clock, COP raw, aliases)"`

---

### Task 7: `st.py` — tokenizer, parser e executor do subset ST

**Files:**
- Create: `sim_core/logix/st.py`
- Test: `tests/test_st.py`

**Interfaces:**
- Consumes: `TagDb`, `ExecCtx`, registry de `instructions.py` (chamadas `COP(...)`, `TONR(...)` em ST)
- Produces:
  - `parse_st(lines: list[str]) -> list[Stmt]` — AST: `Assign(target: str, expr)`, `If(cond, body, elifs: list[tuple], orelse)`, `Case(expr, whens: list[tuple[list[int], list[Stmt]]], orelse)`, `CallStmt(op, args)`
  - `exec_st(stmts, ctx) -> None`
  - Expressões: `or → and → not → cmp (=, <>, <, >, <=, >=) → add/sub → mul/div → unary → atom (literal | path | paren | call?)`; `AND/OR/NOT/XOR` case-insensitive; literais int/real; comentários `//` até fim da linha
  - Subset EXATO do aterramento (2026-07-11): `IF/ELSIF/ELSE/END_IF`, `CASE OF/END_CASE`, `:=`, sem `FOR/WHILE/REPEAT/MOD/EXIT` — qualquer um destes ⇒ `LoadError` no parse (falha ruidosa)

- [ ] **Step 1: teste falhando**

```python
import pytest
from sim_core.clock import SimClock
from sim_core.logix.tagdb import TagDb
from sim_core.logix.st import parse_st, exec_st
from sim_core.logix.instructions import ExecCtx
from sim_core.errors import LoadError

def ctx():
    db = TagDb({})
    for n, t in [("X","DINT"),("Y","DINT"),("F","REAL"),("B","BOOL"),("C","BOOL")]:
        db.create(n, t)
    return ExecCtx(db, SimClock(dt_ms=10), None)

def run(c, src): exec_st(parse_st(src.splitlines()), c)

def test_assign_and_arith():
    c = ctx(); run(c, "X := 2 + 3 * 4; F := X / 2.0;")
    assert c.db.get("X") == 14 and abs(c.db.get("F") - 7.0) < 1e-6

def test_if_elsif_else():
    c = ctx(); c.db.set("X", 5)
    run(c, """
IF X > 10 THEN
    Y := 1;
ELSIF X > 3 THEN
    Y := 2;   // comentário
ELSE
    Y := 3;
END_IF;""")
    assert c.db.get("Y") == 2

def test_case():
    c = ctx(); c.db.set("X", 2)
    run(c, """
CASE X OF
    1: Y := 10;
    2: Y := 20;
ELSE
    Y := 0;
END_CASE;""")
    assert c.db.get("Y") == 20

def test_bool_ops_and_compare():
    c = ctx(); c.db.set("B", 1); c.db.set("X", 4)
    run(c, "C := B AND NOT (X <> 4);")
    assert c.db.get("C") == 1

def test_unsupported_construct_is_loud():
    with pytest.raises(LoadError):
        parse_st(["FOR i := 0 TO 3 DO", "END_FOR;"])

def test_real_servo1_parses():
    from pathlib import Path
    from sim_core.logix.l5x_parser import parse_l5x
    doc = parse_l5x(Path("profiles/iris-03007/l5x/Servo_Program.L5X"))
    parse_st(doc.programs["Servo_Program"].routines["Servo1"].st_lines)  # não levanta

def test_real_r030_parses():
    from pathlib import Path
    from sim_core.logix.l5x_parser import parse_l5x
    doc = parse_l5x(Path("profiles/iris-03007/l5x/R030_ManualMotion_Routine.L5X"))
    (r,) = [rt for p in doc.programs.values() for rt in p.routines.values()]
    parse_st(r.st_lines)
```

- [ ] **Step 2:** Run → FAIL
- [ ] **Step 3: implementação** — tokenizer regex único (`\d+\.\d+|\d+|:=|<>|<=|>=|[A-Za-z_][\w:\[\].]*|[-+*/():;,=<>]`), strip de `//...`; parser recursivo-descendente; keywords não viram Ref. Executor avalia expressões contra TagDb (`get` em Ref, aritmética Python com coerção; comparações → 0/1); `CallStmt` despacha no registry de instructions com `cond=True`. Paths com índice de array/variável? — o aterramento mostra índices literais; índice por variável (`Arr[X]`) se aparecer nos L5X reais: suportar resolvendo o valor no momento do acesso (implementar direto — os testes reais pegam).
- [ ] **Step 4:** Run → PASS (inclusive Servo1 e R030 reais inteiros)
- [ ] **Step 5:** `git add -A && git commit -m "feat(logix): interpretador ST subset (IF/CASE/:=/bool) validado nas rotinas v5 reais"`

---

### Task 8: `controller.py` — scan loop, prescan, JSR, validação de load

**Files:**
- Create: `sim_core/logix/controller.py`, `sim_core/errors.py`
- Test: `tests/test_controller.py`

**Interfaces:**
- Consumes: tudo acima
- Produces:
  - `class Controller(name: str)`:
    - `.load(docs: list[L5xDoc], extra_tags: list[TagDecl], config: dict)` — monta TagDb (UDTs de todos os docs + builtin `TIMER`; tags controller+program; tags de módulo declaradas em `config["modules"]`, ex.: `{"AnyBusComm": {"input_bytes": 128, "output_bytes": 128}}` → cria `AnyBusComm:I`/`:O` com member `Data` SINT[n]); valida TODAS as rotinas (parse RLL + parse ST adiantados) coletando erros; rotinas FBD precisam estar em `config["fbd_excluded"]` senão erro; retorna `LoadReport(errors: list[str])` e levanta `LoadError(errors)` se houver qualquer um
    - `.scan()` — executa `main_program.main_routine` (JSRs recursivos), depois incrementa clock: ordem exata = ler inputs é responsabilidade externa (SimSession), `scan()` só roda lógica
    - `.first_scan: bool` — exposto como tag `S:FS` (BOOL) setada no 1º scan e limpa depois; prescan simplificado no load: OTE targets ficam como estão (zerados por default), ONS storage bits setados, timers zerados
    - `.faulted: bool` + `MajorFault(exc)` — index-out-of-range/divisão por zero durante scan seta `.faulted` e interrompe o scan
    - JSR: resolve rotina no MESMO programa; JSR para rotina FBD excluída = no-op registrado (1 warning por rotina)
  - `sim_core/errors.py`: `class LoadError(Exception)` com `.errors: list[str]`; `class MajorFault(Exception)`

- [ ] **Step 1: testes falhando**

```python
import pytest
from sim_core.errors import LoadError
from sim_core.logix.controller import Controller
from sim_core.logix.l5x_parser import L5xDoc, ProgramDef, RoutineDef, TagDecl

def make_doc(rungs_main, st_sub=None):
    p = ProgramDef("P", main_routine="Main")
    p.routines["Main"] = RoutineDef("Main", "RLL", rungs=rungs_main)
    if st_sub:
        p.routines["Sub"] = RoutineDef("Sub", "ST", st_lines=st_sub)
    d = L5xDoc(); d.programs["P"] = p
    d.tags = [TagDecl("A", "BOOL"), TagDecl("B", "BOOL"), TagDecl("N", "DINT")]
    return d

def test_scan_runs_jsr_and_first_scan():
    c = Controller("iris")
    c.load([make_doc(["XIC(S:FS)OTE(B);", "JSR(Sub,0);"], ["N := N + 1;"])],
           [], {"modules": {}, "fbd_excluded": []})
    c.scan()
    assert c.db.get("B") == 1 and c.db.get("N") == 1
    c.scan()
    assert c.db.get("B") == 0 and c.db.get("N") == 2   # S:FS só no 1º scan

def test_load_error_aggregates():
    d = make_doc(["XIC(A)FRQ(B);"], ["FOR i := 0 TO 2 DO", "END_FOR;"])
    c = Controller("iris")
    with pytest.raises(LoadError) as e:
        c.load([d], [], {"modules": {}, "fbd_excluded": []})
    msgs = "\n".join(e.value.errors)
    assert "FRQ" in msgs and "FOR" in msgs            # TODOS os problemas de uma vez

def test_fbd_requires_explicit_exclusion():
    d = make_doc(["JSR(Pid,0);"])
    d.programs["P"].routines["Pid"] = RoutineDef("Pid", "FBD")
    c = Controller("iris")
    with pytest.raises(LoadError):
        c.load([d], [], {"modules": {}, "fbd_excluded": []})
    c2 = Controller("iris")
    c2.load([d], [], {"modules": {}, "fbd_excluded": ["Pid"]})  # ok
    c2.scan()                                                   # JSR p/ FBD = no-op

def test_module_tags_created():
    c = Controller("iris")
    c.load([make_doc(["NOP();"])], [],
           {"modules": {"AnyBusComm": {"input_bytes": 128, "output_bytes": 128}},
            "fbd_excluded": []})
    c.db.set("AnyBusComm:I.Data[63]", 7)
    assert c.db.get("AnyBusComm:I.Data[63]") == 7

def test_runtime_fault_sets_faulted():
    c = Controller("iris")
    c.load([make_doc(["NOP();"], ["N := N / 0;"])], [], {"modules": {}, "fbd_excluded": []})
    # forçar JSR ao Sub:
    c2 = Controller("iris")
    c2.load([make_doc(["JSR(Sub,0);"], ["N := N / 0;"])], [], {"modules": {}, "fbd_excluded": []})
    c2.scan()
    assert c2.faulted
```

- [ ] **Step 2:** Run → FAIL
- [ ] **Step 3: implementação** — pontos-chave: load compila (parse) todas as rotinas adiantado e guarda ASTs; validação percorre ASTs coletando ops fora do registry (RLL) — o parser ST já levanta LoadError por construto, capturar e agregar; `S:FS` = tag BOOL reservada; módulos: UDT sintético `_MOD_IN_128` com member `Data SINT[128]`; scan envolve try/except `ZeroDivisionError/IndexError/KeyError` → `.faulted=True` + log com rotina/rung.
- [ ] **Step 4:** Run → PASS
- [ ] **Step 5:** **Teste de aceitação da Fase 0** — carregar o perfil REAL inteiro em `tests/test_controller.py::test_load_real_iris_profile`:

```python
def test_load_real_iris_profile():
    from pathlib import Path
    from sim_core.logix.l5x_parser import parse_l5x
    from sim_core.logix.csv_tags import parse_tags_csv
    L = Path("profiles/iris-03007/l5x")
    docs = [parse_l5x(L / f) for f in
            ["Servo_Program.L5X", "R030_ManualMotion_Routine.L5X",
             "R031_Homing_Routine.L5X", "R003_Faults_Routine.L5X"]]
    tags, _aliases = parse_tags_csv(L / "new-controller-tags.CSV")
    c = Controller("iris")
    c.load(docs, tags,
           {"modules": {"AnyBusComm": {"input_bytes": 128, "output_bytes": 128}},
            "fbd_excluded": []})
    c.scan()
```

Se este teste revelar instruções/construtos ausentes (a LoadError lista todos): implementar cada um no registry com mini-teste próprio em `test_instructions.py`, repetir até verde. Tags referenciadas pelos L5X mas não declaradas (estão no ACD completo do Willer): o load as reporta; resolver adicionando `profiles/iris-03007/l5x/missing-tags.json` (lista TagDecl complementar, documentada no PROVENANCE.md) — NUNCA auto-criando tags em silêncio.

- [ ] **Step 6:** `git add -A && git commit -m "feat(logix): Controller — scan loop, S:FS, JSR, LoadError agregado; carrega o programa IRIS v5 real"`

---

### Task 9: `plant/drive.py` — drive CiA-402 (subset v5) + `iomap.py`

**Files:**
- Create: `sim_core/plant/drive.py`, `sim_core/plant/iomap.py`
- Test: `tests/test_drive.py`

**Interfaces:**
- Consumes: `SimClock`; layout de assembly do Global Constraints (In 21 B, Out 8 B)
- Produces:
  - `class DriveModel(axis_cfg: dict, clock: SimClock)` com `axis_cfg` = entrada de `plant.json`: `{"counts_per_mm": 1000, "travel_mm": 2000, "v_max_mm_s": 300, "acc_mm_s2": 1000, "home_switch_mm": 5.0}`
  - `.write_out(data: bytes)` — consome os 8 bytes de saída do PLC (layout do v5: controlword INT em 0–1, `TouchProbeFunc` INT em 2–3, target DINT em 4–7 — **confirmar offsets contra o UDT `Servo1_Out` real no Step 2 e fixar no teste**)
  - `.read_in() -> bytes` — produz os 21 bytes de entrada (statusword, ActualPosition DINT em counts, probe status/value — idem: offsets do UDT `Servo1_In` real)
  - `.step()` — integra 1 tick: máquina 402 (`SwitchOnDisabled → ReadyToSwitchOn → SwitchedOn → OperationEnabled` via bits do controlword 0x06/0x07/0x0F; fault reset bit 7; **Halt bit 8** congela rampa), modos PP (novo alvo por toggle new-setpoint bit 4) e PV (velocity alvo), rampa trapezoidal limitada por `v_max/acc`, posição em counts; touch probe: quando habilitado via `TouchProbeFunc` e a posição cruza `home_switch_mm`, latcha `probe_value` e seta bit de probe no In
  - `.state` dict para asserts de teste (`position_mm`, `velocity_mm_s`, `op_state`, `fault`)
  - `iomap.py`: `class IoMap(bindings: list[Binding])`, `Binding(drive: DriveModel, in_offset: int, out_offset: int)`; `.flush_outputs(db)` lê `AnyBusComm:O.Data[out_offset:+8]` → `drive.write_out`; `.load_inputs(db)` escreve `drive.read_in()` → `AnyBusComm:I.Data[in_offset:+21]`

- [ ] **Step 1: extrair o layout REAL dos UDTs** — antes do teste: `grep -A30 '<DataType Name="Servo1_In"' profiles/iris-03007/l5x/*.L5X` (e `Servo1_Out`); anotar os membros/ordem no docstring de `drive.py` e escrever os testes com os offsets REAIS. Se os UDTs não estiverem em nenhum L5X copiado, buscar no pmo (`plc/2026.07.11_programa-plc-rockwell-r2/` ou pedir export ao Pedro) — bloquear a task, não chutar.

- [ ] **Step 2: teste falhando (com offsets confirmados)** — estrutura (valores de offset a fixar no Step 1):

```python
import struct
from sim_core.clock import SimClock
from sim_core.plant.drive import DriveModel

CFG = {"counts_per_mm": 1000, "travel_mm": 2000,
       "v_max_mm_s": 300, "acc_mm_s2": 1000, "home_switch_mm": 5.0}

def drive():
    return DriveModel(CFG, SimClock(dt_ms=10))

def cw(word, **kw):  # helper monta os 8 bytes de saída
    out = bytearray(8)
    struct.pack_into("<h", out, 0, word)
    if "probe" in kw: struct.pack_into("<h", out, 2, kw["probe"])
    if "target" in kw: struct.pack_into("<i", out, 4, kw["target"])
    return bytes(out)

def test_402_enable_sequence():
    d = drive()
    for word in (0x06, 0x07, 0x0F):
        d.write_out(cw(word)); d.step()
    assert d.state["op_state"] == "OperationEnabled"

def test_pv_ramps_and_halt():
    d = drive()
    for word in (0x06, 0x07, 0x0F): d.write_out(cw(word)); d.step()
    d.set_mode("PV"); d.write_out(cw(0x0F, target=100_000))  # 100 mm/s em counts/s
    for _ in range(200): d.step()                             # 2 s
    assert d.state["velocity_mm_s"] > 90
    d.write_out(cw(0x0F | 0x100))                             # Halt bit 8
    for _ in range(200): d.step()
    assert abs(d.state["velocity_mm_s"]) < 1e-6

def test_touch_probe_latches_at_switch():
    d = drive()
    for word in (0x06, 0x07, 0x0F): d.write_out(cw(word)); d.step()
    d.set_mode("PV"); d.write_out(cw(0x0F, probe=1, target=50_000))
    for _ in range(2000): d.step()
    latched = d.state["probe_value_counts"]
    assert latched and abs(latched / CFG["counts_per_mm"] - 5.0) < 0.2
```

- [ ] **Step 3:** Run → FAIL; implementar `drive.py` (máquina de estados como dict de transições; integração `v += a*dt` com clamp; posição clamp em `[0, travel_mm]`) e `iomap.py` (slicing direto no `db.raw("AnyBusComm:I")` — offset do member `Data` dentro do buffer via `db._resolve`, expor helper público `db.buffer_slice(path, length)` em vez de usar interno).
- [ ] **Step 4:** Run → PASS
- [ ] **Step 5:** `git add -A && git commit -m "feat(plant): drive CiA-402 subset v5 (402/PP/PV/halt/probe) + iomap de assemblies"`

---

### Task 10: `session.py` — SimSession + regressão jog/homing (aceitação da Fase 1)

**Files:**
- Create: `sim_core/session.py`, `profiles/iris-03007/profile.json`, `profiles/iris-03007/plant.json`
- Test: `tests/regression/test_jog_homing.py`

**Interfaces:**
- Consumes: tudo
- Produces:
  - `profiles/iris-03007/profile.json`: lista de L5X, CSV, `modules`, `fbd_excluded` (rotinas PID do MainProgram quando ele entrar), bindings iomap `[{axis: "E1", in_offset: 0, out_offset: 0}, …]` (21/42/63 e 8/16/24)
  - `class SimSession.load(profile_dir: Path) -> SimSession` — monta Controller + drives + IoMap a partir dos JSONs
  - `.step(n: int = 1)` — para cada tick: `iomap.load_inputs(db)` → `controller.scan()` → `iomap.flush_outputs(db)` → `drive.step()` × eixos → `clock.tick()`
  - `.run_ms(ms: int)` — conveniência
  - `.poke(path, value)` / `.read(path)` — direto no TagDb (é o verbo `poke` do spec §5; DSL YAML fica p/ Fase 2)
  - `.drives: dict[str, DriveModel]`

- [ ] **Step 1: testes de regressão falhando** — usar os NOMES REAIS das tags v5 (conferir no `new-controller-tags.CSV` e nos READMEs dos pacotes; ajustar os paths abaixo ao fato antes de rodar — ex.: se o comando de jog é `WSCmd_Jog1` por eixo ou array):

```python
from pathlib import Path
import pytest
from sim_core.session import SimSession

@pytest.fixture()
def sim():
    return SimSession.load(Path("profiles/iris-03007"))

def test_boot_never_moves_axes(sim):
    sim.run_ms(2000)
    assert all(abs(d.state["velocity_mm_s"]) < 1e-6 for d in sim.drives.values())

def test_jog_continuous_with_deadman_moves_and_stops(sim):
    sim.run_ms(500)                                   # boot estável
    sim.poke("WSCmd_JogAxis", 1)                      # nomes reais do CSV v5
    sim.poke("WSCmd_JogDir", 1)
    sim.poke("WSCmd_JogDeadman", 1)
    sim.poke("WSCmd_JogRefresh", 1)
    sim.run_ms(1000)
    d = sim.drives["E1"]
    assert d.state["velocity_mm_s"] > 0
    sim.poke("WSCmd_JogDeadman", 0)                   # solta o deadman
    sim.run_ms(1000)
    assert abs(d.state["velocity_mm_s"]) < 1e-6       # parou sem comando

def test_homing_touch_probe_zeroes_position(sim):
    sim.run_ms(500)
    sim.poke("WSCmd_HomeAxis", 1)
    sim.poke("WSCmd_HomeStart", 1)
    sim.run_ms(30_000)                                 # homing 4R/4L→E1→E2 leva tempo sim
    d = sim.drives["E1"]
    assert d.state["homed"]
    assert sim.read("IF_Axis1_ActualPosition_mm") == pytest.approx(0.0, abs=0.5)
```

- [ ] **Step 2:** Run → FAIL (nomes de tag errados aparecem como KeyError do TagDb — corrigir os testes com os nomes reais ANTES de tocar na implementação; anotar o mapa de tags usado no topo do arquivo de teste)
- [ ] **Step 3:** implementar `session.py` (~80 linhas) + JSONs de perfil; iterar: cada divergência agora é OU bug do interpretador/planta (corrigir com teste unitário novo) OU comportamento real do programa v5 (documentar no teste). Regra de decisão: reproduzir o trecho de lógica suspeito num teste mínimo de `test_st.py`/`test_instructions.py`; se o mínimo passa e a regressão falha, o gap está no plant/iomap.
- [ ] **Step 4:** Run `.venv/bin/pytest -q` (suíte inteira) → PASS
- [ ] **Step 5:** `git add -A && git commit -m "feat: SimSession + regressão jog/homing v5 em pure-sim (aceitação Fase 1)"`

---

### Task 11: fechamento — README, push e registro

**Files:**
- Modify: `README.md` (repo novo), `~/JARVIS/changelogs/` (via MCP changelog-writer), `~/JARVIS/journal/`

**Interfaces:**
- Consumes: repo completo das Tasks 0–10

- [ ] **Step 1:** README do repo: o que é (2 parágrafos, link ao spec), quickstart (`python3 -m venv .venv && .venv/bin/pip install -e . pytest && .venv/bin/pytest`), estrutura de pastas, status das fases (0–1 done, 2+ planned).
- [ ] **Step 2:** Criar repo remoto e push (COM aprovação do Pedro na sessão): `gh repo create strokmatic/sdk-line-twin --private`; `git push -u origin feat/v1`; rename para `master` via `gh api` (procedimento da memória `feedback_new_repo_master_push`).
- [ ] **Step 3:** Changelog entry via MCP changelog-writer (workspace novo — criar `changelogs/sdk-line-twin-changelog.md` no formato Keep a Changelog, seção Added).
- [ ] **Step 4:** Journal `~/JARVIS/journal/` do bloco (cascade primeiro: `python3 scripts/okf/cascade.py entry line-twin`), tags `[line-twin,03007,visionking]`; `okf.py index journal`.
- [ ] **Step 5:** `git add -A && git commit -m "docs: README + changelog Fase 0-1"` (no repo novo) — e no JARVIS, commit do journal.

---

## Self-Review (executado na escrita)

1. **Spec coverage (Fases 0–1)**: §3 interpretador (Tasks 3–8 ✓ — RLL, ST, FBD-exclusão, falha ruidosa, MSG stub, aliases reais); §4 plant eixos/drives (Task 9 ✓ — 402/PP/PV/halt/probe/counts↔mm; conveyor/carro/sensores são Fase 2, fora deste plano); §10 Fase 0 aceitação = Task 8 Step 5; Fase 1 aceitação = Task 10. Golden tests contra L19ER = Fase 4 (fora). YAML DSL = Fase 2 (fora; `poke/read` da SimSession é o precursor documentado).
2. **Placeholders**: nenhum TBD; os dois pontos deliberadamente abertos (offsets dos UDTs `Servo1_In/Out`, nomes exatos das tags WSCmd) NÃO são placeholders — são steps de descoberta com instrução exata de como fixá-los no teste antes de implementar (Task 9 Step 1, Task 10 Step 2), porque o fato vive nos artefatos reais e chutar seria pior.
3. **Consistência de tipos**: `ExecCtx(db, clock, controller)` uniforme nas Tasks 6–8; `TagDecl` definido na Task 3 e consumido nas 4/8; `parse_tags_csv` retorna tupla (corrigido na própria Task 4); `SimClock(dt_ms)` com `.tick()/.now_ms` nas Tasks 6/9/10.
