# 03008 Sealer Inspection Station — Linear Axis ↔ S7-1200 Integration & Scan Sequence (Design)

**Projeto:** 03008 — Estação de Inspeção de Sealer — Hyundai Piracicaba<br>
**Data:** 2026-07-03<br>
**Autor:** Pedro Teruel (teruel@strokmatic.com)<br>
**Status:** Draft — aguardando revisão do Pedro (não commitado)

---

## 1. Purpose & Scope

Bring up the motorized linear axis that sweeps the Hikrobot 3D camera along a car body, driven by a **Siemens S7-1200**, and write the PLC program that runs a **step-and-shoot scan** coordinated with the vision IPC and interlocked with the plant robot cell.

**In scope (this milestone = M1 + M2):**
- **M1 — Motion bring-up:** power-on, enable/reset, homing (absolute-encoder origin), jog, and move-to-absolute-position with status feedback, over PROFINET to the Delta drive.
- **M2 — Scan sweep:** step-and-shoot state machine over a per-model list of capture positions (IPC-editable recipe), camera-trigger coordination, and the cycle start/done handshake to the plant PLC and the vision IPC.

**Out of scope (later milestones):**
- Operator HMI / WinCC panels (the vision IPC is the operator/config surface for now).
- Full safety build-out (safety PLC, PROFIsafe, area scanners). This spec defines the **functional** stop logic and the **interface** to an independent hardwired safety STO, but does not design the safety system itself.
- Vision pipeline internals (SEALER-01 point-cloud processor et al.) — consumed as an existing contract.

---

## 2. Hardware Inventory (as received)

> ⚠️ **Supersedes the IGUS procurement docs.** The earlier `compras-eixo-linear.md` / `igus-linear-motion-kit.md` specced an IGUS ZLW-20200 + NEMA-34 stepper + dryve D1. **That is NOT what was purchased.** The source of truth is the **`Sealer - Dimensionamento`** Google Sheet, tab **`LISTA DE COMPONENTES`**.

| Role | Model | Notes |
|---|---|---|
| Linear module | SHELE **EGT125-2500-L-D-K5-M40-S3P** | Belt-driven, 125 mm frame, **2500 mm** stroke |
| Gearbox | **HPF060-005-P2-M40** | Planetary, **5:1**, precision grade P2, M40 motor mount |
| Servo motor | Delta **ECM-E3M-C20604RSE** | 400 W, **no brake**, 24-bit **absolute** encoder |
| Servo drive | Delta **ASD-B3A-0421-P** | ASDA-B3A, 400 W, **-P = PROFINET / PROFIdrive** |
| Cables | ASD-B3-EN0025-G (enc), ASD-B3-PW0025-G (pwr) | 25 m high-flex |
| Controller | Siemens **S7-1214C** | 14 DI / 10 DO, 100 KB work mem — see §13; confirm firmware |
| End sensors | 2× inductive **M12** (Pepperl+Fuchs LJ12A3-4-Z/BX, NPN) | **Wired to the Delta drive CN1** (home → DI4/ORGP, limit → DI2/DI3), **not the PLC** |
| Camera | Hikrobot **MV-DLS1400M-15** | Galvanometric laser **3D** camera; PLC hardware trigger |
| Cover actuation | 2× Thermoval **MI-DA Ø12×50** cylinders + Thermoval **41944 double-solenoid 5/2** valve (bistable) | Camera shutter; lever mechanism inverts sense (retract → open, extend → close) |
| Covers / guides | SHELE 750-L2700-200 (×2), GHR25R guides | Telescopic protection |
| Safety | Safety relay (Phoenix PLC-RSC) + E-Stop | NC contact → **both** S7-1200 DI (monitor) **and** Delta STO/enable (hardwired) |

**Mechanical scaling (to confirm from SHELE EGT125 datasheet):** travel per **motor** revolution = `EGT125_belt_lead_mm ÷ 5` (gearbox). The drive's electronic-gear / user-unit parameters must encode this so that "mm" commanded by the PLC map to true linear travel. The 24-bit absolute encoder resolves far finer than the mechanical repeatability.

---

## 3. System Architecture

The S7-1200 sits at the center of **three distinct comm relationships**:

```
                 ┌──────────────────────────────────────────┐
                 │      Plant PLC  (Siemens S7-300/400)        │  ← cell controller
                 └───────────────▲──────────────────────────── ┘
                                 │ PROFINET  — S7-1200 = I-Device
                                 │ cyclic interlock (robot ↔ axis permissives, alarms)
        ┌────────────────────────┴───────────────────────┐
        │                 S7-1200 (station)                │
        │  • PROFINET IO Controller  ─────────────────────┼──► Delta ASD-B3A-P ─► EGT125 axis
        │  • PROFINET I-Device      → plant PLC             │
        │  • S7 server (PUT/GET)    → plc-monitor           │
        └────────────────────────▲────────────────────────┘
                                 │ S7 / ISO-on-TCP :102 (Snap7)
                                 │ recipes (positions) ↓  ·  status/handshake ↑
        ┌────────────────────────┴───────────────────────┐
        │   IPC (vision)  ── plc-monitor ── Redis ── SEALER-01 …            │
        └──────────────────────────────────────────────────┘
```

- **Drive link (PROFINET IO controller):** the S7-1200 is the IO controller for the Delta drive. Carries the cyclic motion telegram.
- **Plant link (PROFINET I-Device):** the S7-1200 is an I-Device to the plant S7-300/400. Deterministic cyclic interlock (both directions). See §8.
- **IPC link (S7/Snap7 via plc-monitor):** the existing VK `plc-monitor` service reads/writes PLC DataBlocks over Snap7 and bridges them to Redis; the vision stack reads/writes Redis. See §7.

All three share **one flat L2 network** via a **5-port Gigabit switch in the panel** (accepted by Pedro): S7-1200, Delta drive, and Boxer on the switch, with the plant S7-300 on the uplink. The drive (IO controller) and the plant (I-Device) coexist on the S7-1200's single PROFINET interface.

---

## 4. Motion-Control Architecture — Decision

**Chosen: B — drive-side positioning.** The Delta B3 owns the position loop; the S7-1200 is a **coordinator** (sequencing, recipe, interlock, comms). Rationale (settled with Pedro):

1. **Efficiency / headroom** — with the drive closing the position loop, the compact S7-1200 spends its budget on I-Device + S7 server + sequencing, not on a cyclic servo loop. Directly serves the "must run all this efficiently" requirement.
2. **The IPC is the operator/config surface**, not a Siemens HMI — which neutralizes architecture A's main advantage (turnkey TO diagnostics + WinCC faceplates).
3. **Recipe-driven targets** map cleanly onto handing the drive an absolute target + velocity per step.
4. Bus-jitter tolerance (the loop doesn't ride PROFINET) and a clean functional split (drive = motion, PLC = cell logic).

Precision is **not** a differentiator: step-and-shoot captures at standstill, where following error has decayed; at-rest accuracy is set by the mechanics (belt module + 5:1 gearbox), identical across architectures.

> ✅ **RESOLVED — ASDA-B3 UM §13 (in `references/DELTA_IA-ASD_ASDA-B3_UM_EN_20250108.pdf`).** The B3A-P supports PROFIdrive application classes **AC1/AC3/AC4**. Architecture B = **AC3, "Profile Position mode" via Standard Telegram 111**: the controller writes the target position + velocity, and the **drive's trajectory generator** reaches it. Telegram 111 runs over **PROFINET RT** (12/12 PZD words) → works on the **S7-1200** (RT, not IRT). AC4 (Tel. 3/102/105) wants **IRT** for Tel.105 — a poor fit for the S7-1200 — so B is the natural fit, not just the preference.
>
> **Telegram 111 process data (`FB_Axis` maps to these):**
> - **Controller → drive:** `STW1`, `POS_STW1`, `POS_STW2`, `STW2`, `MDI_TARPOS` (I32), `MDI_VELOCITY` (I32), `MDI_ACC` (I16), `MDI_DEC` (I16).
> - **Drive → controller:** `ZSW1`, `POS_ZSW1`, `POS_ZSW2`, `ZSW2`, `XIST_A` (actual pos), `NIST_B` (actual speed), `FAULT_CODE`, `WARN_CODE`.
>
> **A GSD file IS required** (§13.1.2 "GSD file import") — the overview's *"PROFINET nativo, sem GSD externo"* is **wrong**. Still need the GSDML (≥ V2.41; from ASDA-Soft install dir or supplier). Position→mm scaling via electronic gear (P1.044) + position factor (6093h).

**Reversibility:** the `FB_Axis` wrapper (§5) isolates the drive mechanism. Switching to architecture A (S7-1200 TO + Telegram 3) later touches only `FB_Axis`, not the scan sequence, recipe, or interlock.

---

## 5. `FB_Axis` — Axis Abstraction

Single block that hides the PROFIdrive/drive state machine behind a PLCopen-style interface. The scan sequencer talks **only** to this.

**Implementation: hand-rolled Telegram 111** (decided 2026-07-03). Rationale for our case: the drive is **Delta, not SINAMICS** (SINA_POS parity risk you can't lean on either vendor to resolve), we want the **whole program as reviewable text now**, a **lean footprint** for a possible 1211C, **portability** to "TIA or equivalent", and a **transparent first bring-up** — and our feature set (MoveAbs/Jog/one-time Home) is small with every telegram bit already pinned down. **SINA_POS (FB284) is kept as a drop-in plan B** behind this same interface (see `commissioning.md`).

**Inputs:** `Enable`, `Reset` (fault ack), `Home` (trigger origin routine), `MoveAbs` (exec), `TargetPos_mm`, `Velocity_mmps`, `Jog_Pos`, `Jog_Neg`, `Stop` (functional **Halt** = STW1.5 intermediate stop — resumable, no fault), `TorqueOff` (functional OFF2 via telegram), `LinkOK` (drive submodule health).

> **Accel/decel are NOT per-move telegram values.** Telegram 111 carries only `MDI_ACC`/`MDI_DEC` as **percent overrides** of the drive's ramp base **PNU43/PNU44** — which default to **1 ms** (a belt slam) and are **volatile**. So the ramp times are set at power-up by **`FB_DriveParams`** (acyclic WRREC), and `MDI_ACC/DEC` are held at 100%. Recipe `accel`/`decel` (mm/s²) therefore configure `FB_DriveParams`, not each move. Same for jog speed/dir (PNU23/24) and home method (PNU10). This corrects the earlier §7.1 assumption.

**Outputs:** `Ready` (enabled, no fault), `Busy` (move in progress), `Done` (target reached, in-position window), `InPosition`, `ActPos_mm`, `ActVel_mmps`, `Homed`, `Fault`, `FaultID` (mapped from drive ZSW + Delta AL.xxx), `LimitPos`, `LimitNeg`.

**Internal responsibilities:**
- Enable sequence (STW1, Telegram 111): **STW1.10 = 1** (control-by-PLC) **first**; clear OFF2 (STW1.1 = 1) + OFF3 (STW1.2 = 1); Servo-ON (STW1.0 = 1); enable operation (STW1.3 = 1).
- `MoveAbs`: write `MDI_TARPOS` / `MDI_VELOCITY` / `MDI_ACC` / `MDI_DEC` + `POS_STW` (absolute mode), then a **rising edge on STW1.6 (Trigger)** to execute; confirm via `ZSW1` / `POS_ZSW` "target reached" + `XIST_A`.
- `Jog±` = STW1.8 / STW1.9; `Home` = STW1.11; `Reset` = STW1.7 (rising edge).
- Two stop categories, **both over the PROFINET telegram** (no PLC→STO DO exists in this design): **`Stop`** → **Halt** (STW1.5 = 0, intermediate stop: decelerate, hold position, **resumable with no fault and no reset**); **`TorqueOff`** → OFF2 (disable voltage → coast). ⚠️ OFF3 (STW1.2) is deliberately **not** used for functional stops — it raises **AL35F** and needs an edge-triggered ARST that deadlocks a recoverable abort (review CRIT-1). Neither functional stop is the safety stop — safety STO is the hardwired safety-relay NC into the drive (§9).
- Expose actual position (`XIST_A`, scaled to mm) and a decoded fault ID.

**States:** `DISABLED → ENABLING → HOMING → READY → MOVING → IN_POSITION`, plus `FAULTED` (any state, on drive fault / limit / bus loss) and `STOPPING`.

---

## 6. Scan Sequence — Step-and-Shoot State Machine

One physical bead-scan cycle. Positions come from the **active-model recipe** (§7). The camera is a galvanometric 3D sensor: it captures a full 3D patch per trigger; the axis indexes between patches; SEALER-01 merges patches by `encoder_position_mm` (translation-only registration).

```
IDLE        (cover CLOSED, axis at park)
 └─(plant: StartScan + ModelID valid + IPC recipe loaded + Ready)→ COVER_OPEN
COVER_OPEN  FB_Cover.Open (pulse Y1); wait open_delay_ms   → HOME_CHECK
HOME_CHECK  (verify Homed; else run Home)                 → MOVE_TO[i=0]
MOVE_TO[i]  FB_Axis.MoveAbs(pos[i], vel[i])               → SETTLE[i]
SETTLE[i]   wait InPosition + settle_ms (recipe)          → TRIGGER[i]
TRIGGER[i]  pulse camera trigger DO; publish {i, pos[i]}  → WAIT_CAP[i]
WAIT_CAP[i] wait capture-done (or dwell_ms)               → (i<N-1? MOVE_TO[i+1] : SCAN_DONE)
SCAN_DONE   MoveAbs(park)                                 → PARK
PARK        InPosition(park); FB_Cover.Close (pulse Y2)   → CLOSING
CLOSING     wait close_delay_ms; signal plant "scan complete" + "axis safe" → IDLE
```

Fault/abort transitions (from any state): plant hard-alarm or drive fault → `ABORT` → functional stop (§9) → `FAULTED`; on `Reset` + clear → `IDLE`.

- **N and pos[i]** are per-model (recipe). Each frame's `encoder_position_mm` = commanded `pos[i]` (deterministic; also cross-checked against `FB_Axis.ActPos_mm` at trigger time).
- **Permissive gating:** `MOVE_TO` only proceeds while the plant "axis-may-move" permissive is true (robot clear); loss of permissive mid-move → `Stop` (Halt).
- **Park** = a safe retracted position clearing the robot envelope, signaled to the plant.

---

## 7. Recipe & Handshake Data Model (IPC ↔ PLC via plc-monitor)

The existing VK **`plc-monitor`** (C++/Snap7, `Cli_DBRead`/`Cli_DBWrite`, JSON tag catalog `pontoN.json`, DB↔Redis-hash bridge) is reused. Flow: **IPC → Redis → plc-monitor → PLC DB** (recipe write) and the reverse for status.

**Constraint:** DBs exchanged with plc-monitor must be **non-optimized (standard) block access** (Snap7 addresses by absolute byte offset). Keep all other DBs optimized.

### 7.1 `DB_Recipe` (IPC → PLC, `plc_write:true`)
Active-model capture plan, pushed by the IPC when the model is known:
| Field | Type | Notes |
|---|---|---|
| `model_id` | INT/STRING | matches plant `ModelID` |
| `n_positions` | INT | 1…`MAX_POS` (define `MAX_POS`, e.g. 32) |
| `positions[MAX_POS]` | REAL (mm) | absolute axis targets |
| `velocity`, `accel`, `decel` | REAL | per-scan motion dynamics |
| `settle_ms`, `dwell_ms` | INT | per-position settle + capture wait |
| `recipe_valid` | BOOL | IPC sets after a full consistent write |

The **IPC is the recipe SSOT** (all models); it pushes only the *active* model's plan. `recipe_valid` guards against reading a half-written recipe.

### 7.2 `DB_Status` (PLC → IPC, `plc_read:true`)
| Field | Type | Notes |
|---|---|---|
| `state` | INT | scan state-machine enum |
| `act_pos_mm`, `act_vel` | REAL | live axis feedback |
| `homed`, `ready`, `busy`, `fault` | BOOL | axis health |
| `fault_id` | INT | decoded (drive ZSW + AL.xxx) |
| `current_index` | INT | position being captured |
| `capture_pulse` | BOOL | trigger fired for `current_index` |
| `scan_complete` | BOOL | full cycle done |

### 7.3 `DB_Cmd` (IPC → PLC, optional bench control)
`start_scan_sim`, `jog_pos`, `jog_neg`, `reset` — lets the IPC drive M1 bring-up before the plant link exists. Tag-catalog entries added to `pontoN.json` with correct byte offsets + `plc_write:true`.

---

## 8. Plant Interlock — PROFINET I-Device

The S7-1200 presents a fixed transfer area to the plant S7-300/400 (controller). Cyclic, deterministic, **functional (non-safety)** permissives.

**Plant → Station:**
`ModelID`, `AreaFree_AxisMayMove` (robot clear), `StartScanRequest`, `RobotInSafePose`, `PlantAlarm_Soft`, `PlantAlarm_Hard`, `ResetRequest`.

**Station → Plant:**
`StationReady`, `AxisMoving`, `AxisParkedSafe`, `Capturing`, `ScanComplete`, `StationFault`, `HoldRobotRequest`.

- **Alarm reactions (Pedro's requirement):** `PlantAlarm_Soft` → `FB_Axis.Stop` (**Halt**, STW1.5 intermediate stop — hold, resumable, no fault). `PlantAlarm_Hard` → `FB_Axis.TorqueOff` (OFF2 via telegram; coast). See §9 for the safety caveat — the SIL stop remains the hardwired safety-relay path.
- **Bus-loss:** I-Device connection loss → treated as hard alarm → functional stop; the plant sees `StationFault` drop.

> ⚠️ **CONTINGENCY — plant fieldbus.** I-Device requires the plant CPU to have a **PROFINET** port. Many paint-shop S7-300/400 are **PROFIBUS-DP only** → then the S7-1200 couples as a **DP slave via CM 1242-5** and the same signal map rides PROFIBUS instead. Confirm the plant CPU's interface before HW selection (§13).

---

## 9. Stop & Safety Concept

Three independent stop paths, by decreasing severity:

1. **Hardwired safety STO (out of scope to design, in scope to interface):** the **safety-relay (Phoenix PLC-RSC) NC contact** is wired **directly to the Delta drive** (STO/enable) — and the *same* contact to a PLC DI for monitoring. This is the *only* SIL-rated stop. **Independent of the PLC** (the drive drops torque even if the PLC is dead). Confirm the exact drive terminal + dual-channel wiring against the B3A STO certificate.
2. **Functional torque-off (`TorqueOff`, OFF2 via telegram):** PLC commands OFF2 over PROFINET on `PlantAlarm_Hard` or drive fault → torque off (coast). **Non-safety.** There is **no PLC→STO DO** in the current design; a bus-independent functional torque-off would require *added* wiring into the enable/safety chain — flag if wanted.
3. **Functional controlled stop (`Stop`, Halt = STW1.5 via telegram):** decelerate on ramp, hold position, **resumable with no fault/reset**. On `PlantAlarm_Soft` or loss of `AreaFree_AxisMayMove`.

**No motor brake:** on any torque-off the horizontal axis friction-coasts to rest (acceptable — horizontal load, 5:1 gearbox + belt friction). Prefer **Halt** (path 3, STW1.5) for routine functional stops so position is held under control and the cycle resumes cleanly with no fault; reserve torque-off/OFF2 for hard alarms.

---

## 10. PLC Program Organization

| Block | Type | Responsibility |
|---|---|---|
| `OB1` | cyclic | call sequencer + FB_Axis + comms mapping (light) |
| `OB_CyclicInterrupt` | optional fast cyclic | tight handshake bits if needed |
| `FB_Axis` | FB | §5 — drive abstraction |
| `FB_ScanSequence` | FB | §6 — step-and-shoot state machine |
| `FB_PlantInterlock` | FB | §8 — I-Device transfer-area mapping + alarm reactions |
| `FB_RecipeIface` | FB | §7 — validate/latch `DB_Recipe`, expose to sequencer |
| `FB_Cover` | FB | pulse open/close coils of the bistable valve; enforce power-up safe default |
| `FB_DriveParams` | FB | acyclic WRREC of volatile PNUs (jog/home/accel) at power-up |
| `DB_Recipe`, `DB_Status`, `DB_Cmd` | DB (non-optimized) | IPC interface (Snap7) |
| `DB_AxisIf` | DB | telegram I/O image ↔ FB_Axis |
| PLC data types (UDT) | — | `RecipeType`, `AxisStatusType`, `InterlockType` |

TIA project settings: enable **PUT/GET** access; drive imported via **GSDML** (≥ V2.41); telegram per §4.

### 10.1 Hardwired I/O List (S7-1200)

Grounded in the overview electrical diagram (rev 2026-05-07). Deliberately minimal — axis sensing and control live on the drive/telegram, not the PLC.

**Digital Inputs (24 VDC)**
| # | Signal | Source | Notes |
|---|---|---|---|
| DI1 | E-Stop / safety-relay NC | Phoenix PLC-RSC | monitor only; same NC also drops the Delta STO/enable (hardwired safety, §9.1) |
| DI2 *(opt.)* | Pressostato "ar OK" | filtro-regulador | not shown wired in the main diagram — add only if an air-OK interlock is wanted |

**Digital Outputs (24 VDC)**
| # | Signal | Target | Notes |
|---|---|---|---|
| DO1 | Camera trigger | Hikrobot MV-DLS1400M | pulse per capture position |
| DO2 | Cover valve **OPEN** coil (Y1) | Thermoval 41944 | bistable — **pulse** to open |
| DO3 | Cover valve **CLOSE** coil (Y2) | Thermoval 41944 | bistable — **pulse** to close |

**Bistable-valve caveat:** the 41944 holds its last position on power/air loss (no spring return). Define a **power-up safe default** — `FB_Cover` pulses **close** on startup so the camera shutter is protected regardless of prior state.

**On the drive / PROFINET — NOT PLC I/O:** home sensor → Delta CN1 DI4 (ORGP); limit → Delta CN1 DI2/DI3 (NL/PL); axis enable / move / position / status / fault / OFF2 / Halt (STW1.5) → telegram; safety-relay NC → Delta STO/enable.

**Tally: 1 DI (+1 opt.) / 3 DO** — fits any S7-1200 including the 1211C on I/O count (see §13).

---

## 11. Camera-Trigger Coordination

- PLC `DO_CameraTrigger` → Hikrobot hardware trigger input (via the M12 12-pin cable). Pulsed in `TRIGGER[i]` after `InPosition` + `settle_ms`.
- Capture-done: no PLC strobe DI in this design. Use a "frame acquired" acknowledge from the Boxer/IPC over Redis (`DB_Cmd`/`DB_Status`); fallback = fixed `dwell_ms`.
- Position tagging: SEALER-01 needs `encoder_position_mm` per frame. Deterministic source = commanded `pos[i]`; the PLC also publishes `act_pos_mm` at trigger for cross-check. No continuous encoder streaming needed (step-and-shoot).

---

## 12. Homing & Absolute Encoder

- ECM-E3M has a **24-bit absolute** encoder → position retained at power-off. **No home-every-cycle.**
- Commissioning: mechanically reference to the **Sick home sensor** + flag, then set the drive absolute origin (ASDA-Soft absolute-position reset). Thereafter `Homed` is latched from the drive.
- `FB_Axis.Home` = optional re-reference/verify against the home sensor + software limits; not part of the normal cycle.
- **HW limit protection** in the drive (positive/negative limit inputs / P-params) — independent of the sequence and of PROFINET.

---

## 13. Controller Selection (CPU)

**CPU: Siemens S7-1214C (confirmed).** Comfortable fit: **14 DI / 10 DO** onboard (our load is only 1 DI / 3 DO — ample spare), **100 KB** work memory, and it supports acting as a PROFINET **IO-controller** (Delta drive) **and** an **I-Device** (plant S7-300) **and** a **PUT/GET server** (plc-monitor) simultaneously. The panel already has a 5-port Gigabit switch, so the single PN interface is fine.

Only remaining check: **firmware version** — I-Device + Telegram 111 want a reasonably recent FW (≥ V4.x); confirm it and pin the TIA version to match.

---

## 14. Assumptions to Confirm (blocking flags)

1. ✅ **Drive mechanism (§4): RESOLVED** — AC3 / Telegram 111 (Profile Position, RT) per ASDA-B3 UM §13. `FB_Axis` internals defined.
2. **Plant fieldbus (§8):** plant is a Siemens **S7-300** (confirmed). Confirm its CPU has a **PROFINET** port (→ I-Device), not PROFIBUS-DP-only (→ CM 1242-5).
3. ✅ **CPU: S7-1214C (confirmed).** Remaining: confirm **firmware version** (≥ V4.x for I-Device + Tel.111) and pin the matching TIA version.
4. **GSD (§4):** a GSD **is** required (UM §13.1.2) — the overview's *"sem GSD externo"* is wrong. Still need the **GSDML file** (≥ V2.41) + drive **FW ≥ v2.00009 sub10058** (UM §13.1.4 — the earlier "v3109 sub8387" was wrong; ⚠️ correct the supplier request) — from the **ASDA-Soft install dir** or supplier.
8. **DI reassignment (UM §3.3.2.1):** CN1 **DI4 defaults to EMGS, not ORGP** → set **P2.013 := ORGP (0x24)** for the home sensor. PROFINET enable = **P1.001.YX=0C + P3.012.Z=1**; **P1.120** is the STO-deactivation option (handle AL500 in reset), not servo-on source.
5. **EGT125 belt lead + HPF060 5:1** for position scaling (§2).
6. **plc-monitor `pontoN.json`** extended with the new DBs (offsets, `plc_write` flags) — non-optimized DBs.
7. **Cover valve (§10.1):** 41944 is bistable (2 DO, pulsed); confirm the power-up *pulse-close* safe default is acceptable, and whether a cover open/closed sensor is needed (none in current BOM → state = command + timing).

---

## 15. References

- Sealer pipeline: `docs/superpowers/specs/2026-04-13-sealer-01-point-cloud-processor-design.md` (frame model, `encoder_position_mm`, `sealer_model_frames_map`).
- **Electrical/automation SSOT:** `pmo/projects/03008/reports/md/overview.md` §"Diagrama Elétrico e de Automação" (rev 2026-05-07) — I/O map, drive CN1 sensor wiring, safety-relay routing.
- `pmo/projects/03008/reports/md/{technical-specs-sourcing-en,compras-pneumatica}.md` — cover/valve/sensor specs.
- `Sealer - Dimensionamento` gsheet, tab `LISTA DE COMPONENTES` (hardware SSOT).
- `plc-monitor`: `workspaces/strokmatic/visionking/services/plc-monitor` (Snap7 bridge, `ponto1.json` tag catalog).
- **ASDA-B3 User Manual EN** — `references/DELTA_IA-ASD_ASDA-B3_UM_EN_20250108.pdf` (1023 pp): **§13 PROFINET Mode** (§13.3 application classes AC1/AC3/AC4, §13.4 control/status words, §13.5.1 Telegram 111 Profile Position, §13.1.2 GSD import), §7 PR mode, §11/§12 CiA-402 objects.
- Delta Download Center (GSDML **not** published standalone → ASDA-Soft/supplier): ASDA-Soft V7.2.14.0 (DID 50098), Profidrive cert (DID 50306), CANopen EDS (DID 21851), EtherCAT ESI (DID 21858).

---

## Histórico de Mudanças

| Data | Autor | Mudança |
|---|---|---|
| 2026-07-03 | Pedro Teruel | Draft inicial — arquitetura B, step-and-shoot, 3 interfaces (drive PN / plant I-Device / IPC S7), FB_Axis, recipe via plc-monitor. |
| 2026-07-03 | Pedro Teruel | Grounded I/O in overview electrical diagram: real S7-1200 I/O = **1 DI (+1 opt) / 3 DO** (E-stop monitor; camera trigger + 2× cover-valve coils). Removed invented beacon/horn/reed/reset/strobe/brake. Sensors → drive CN1. Functional stops via telegram OFF2/OFF3 (no PLC→STO DO). Added FB_Cover + cover steps in the sequence. Softened CPU §13 — 1211C viable. Flagged bistable-valve safe default + "GSD nativo" claim. |
| 2026-07-03 | Pedro Teruel | **Item #1 RESOLVED** from ASDA-B3 UM §13 (downloaded to `references/`): architecture B = **AC3 / Telegram 111 (Profile Position, RT)**; documented the Tel.111 PZD map + STW1 bit sequence in §4/§5. Item #4: GSD confirmed **required** (§13.1.2) — overview "sem GSD" is wrong; GSDML still to obtain from ASDA-Soft/supplier. |
| 2026-07-03 | Pedro Teruel | `FB_Axis` locked to **hand-rolled Telegram 111** (§5) — SINA_POS kept as plan B. Started SCL scaffold at `pmo/projects/03008/plc/`: UDTs (Tel111 TX/RX, AxisIf, Recipe, AxisStatus, Interlock), `FB_Axis`, `FB_Cover`, `FB_ScanSequence`, `OB_Main`, `commissioning.md`. |
| 2026-07-03 | Pedro Teruel | **Independent Fable review** (manual-verified) → applied fixes. **Critical:** `POS_STW1.14→FALSE` (was selecting set-up mode = never moves); write `MDI_ACC/DEC=100%` + new **`FB_DriveParams`** WRREC subsystem for volatile PNU43/44/23/24/10; fixed stale-`ZSW1.10` phantom-`Done` race + `FB_ScanSequence` timer calls. **High:** telegram via `DPRD_DAT/DPWR_DAT` (not S7-1500 I/O-tags); `FB_Axis` gates READY on ZSW1.2 + honors `Enable`/link-loss; `EStopHealthy` polarity; indexed capture-ack; latched `ScanComplete`; drive-fault abort; ActVel normalization. **Docs:** FW = **v2.00009 sub10058** (not v3109/sub8387), P1.120 is STO-deactivation, DI4→ORGP via P2.013, accel/decel contract (above). Sign-of-life confirmed **not** required. Bench plan under separate Fable review. |
| 2026-07-03 | Pedro Teruel | CPU confirmed **S7-1214C** (§2/§13/§14). Scaffold completed: `FB_RecipeIface`, `FB_PlantInterlock`, global DBs (`DB_Global.scl`), full `OB_Main` orchestration, and the **plc-monitor tag catalog** (`tags/plc_tags.json`, 43 tags over DB_Recipe/Status/Cmd) = the IPC↔PLC contract. 12 files, ~800 lines SCL. Not yet compiled (needs TIA). |
| 2026-07-03 | Pedro Teruel | **Bench-plan Fable review** (independent) → `bench_test_plan.md` rev 2: firmware/P1.120/DI4-EMGS/POS_STW1.14/volatile-PNUs/ActVel corrections; added static+single-channel STO tests, power-cycle re-parameterization, limit-in-telegram, PLC↔drive link-loss, inter-phase gates + numeric criteria. Cross-validated the code review's manual facts. |
| 2026-07-03 | Pedro Teruel | **Result Fable review** confirmed all 12 prior Critical/High fixes landed + manual-correct, then flagged regressions from the rewrites → **applied:** **CRIT-1** `FB_ScanSequence` abort deadlock (OFF3→AL35F with no reset + `Ready` never returns) — abort now settles the stop, pulses `ReqReset` to clear AL35F, then parks (v0.3). *(ReqReset approach superseded in the next round — see below.)* **H-1** gate `FB_Axis.Enable` on `FB_DriveParams.Done` (no move on the 1 ms default ramp at power-up). **H-2** removed sequence auto-home (PNU10=35 could re-stamp origin at any position) — a cycle now requires an already-homed axis; homing is operator-only. **H-3** `DB_AxisIf` + `FB_DriveParams` → non-optimized (fixed byte layout for DPRD/DPWR + WRREC RECORD). **Mediums:** `FB_DriveParams` write gated on Execute edge (no PNU-0 write); `LinkOK` derived from `DPRD_DAT` RET_VAL; manual `MoveAbs` gated on sequence idle; monotonic `capture_ack_seq` fresh-ack guard; explicit I-Device `%I`/`%Q`↔`DB_Interlock` copy TODO in `OB_Main`; NPN-NO limit-sensor polarity note. **L-1** `moveStartTmr` driven every scan (no stale phantom-Done). |
| 2026-07-03 | Pedro Teruel | **Verification Fable review** confirmed H-1/H-3/M-1/M-2/M-5/L-1 genuinely fixed, but found the CRIT-1 residual + a new High → **applied:** **CRIT-1 (real fix)** functional stops changed from **OFF3 to Halt (STW1.5 intermediate stop)** in `FB_Axis` — decelerate + hold, stays enabled, **no fault, no reset** → the abort no longer needs `ReqReset` (removed), dissolving the edge-ARST deadlock; the fault-triggered abort now waits for an operator `DB_Cmd.reset` edge (never masked). **HIGH-1** `DB_Cmd.home`/`jog_pos`/`jog_neg` gated on sequence-idle in `OB_Main` (an ungated `home` with method 35 re-stamped the origin mid-scan). **Mediums:** every commanded move now confirmed via `AxisBusy` before it counts (a lost `CmdMoveAbs` pulse can't let a stale `Done` trigger the camera / close the cover at the wrong position); `FB_DriveParams` per-step **REQ pulse** (a level REQ writes only PNU43); `NotHomed` + `FB_DriveParams.Error` published to `DB_Status` (`not_homed`/`param_err`); `settle_ms`/`dwell_ms` validated in `FB_RecipeIface`; abort recovery skips the park move if `Homed` was lost. `FB_Axis` v0.3, `FB_ScanSequence` v0.4, `FB_DriveParams` v0.3. Bench: T5.8 split into functional/fault/not-homed cases. **Still bench-gated:** MDI-not-on-B3A-P (UM note 3 → T2.4, SINA_POS plan B) and whether Halt/OFF2 behave as documented in PN mode (T2.8/T3.7). |
