# Research Report: Siemens NX Open — Python API Tooling

**Date:** 2026-03-05<br>
**Author:** JARVIS Orchestrator<br>
**Status:** Research Complete<br>
**Priority:** Medium<br>

---

## Executive Summary

NX Open is Siemens' official API for programmatic CAD/CAM/CAE automation. Python support has been available since NX 10 (2014) and is mature. The API covers the full breadth of NX functionality. **No MCP server for Siemens NX exists anywhere** — a clear first-mover opportunity. A hybrid architecture using `run_journal` for batch operations and a socket bridge for interactive control avoids the need for an Author license.

---

## 1. Overview

NX Open is the official Application Programming Interface (API) framework provided by Siemens for their NX (formerly Unigraphics) CAD/CAM/CAE software. It gives programmatic access to the NX model, tools, and UI commands.

**Key fact:** NXOpen Python runs inside the NX process via an embedded CPython interpreter. You cannot `pip install NXOpen` — scripts must execute within NX (journal mode) or via the `run_journal` batch utility.

### History

- **Open C / UF (User Function) API** — The original C-based API from the Unigraphics era. Functions prefixed with `UF_`. Still accessible as a legacy layer.
- **NX Open (Common API)** — The modern, object-oriented API introduced around NX 5 (circa 2007). Class-based structure available across multiple languages.

### Supported Languages

1. **C++ (Open C++)** — Native compiled; full API access
2. **C# (.NET)** — Full API access via .NET wrappers
3. **VB.NET** — Full API access; default journal recording language
4. **Java** — Full API access; supports remoting via RMI
5. **Python** — Full API access since NX 10; uses embedded CPython interpreter

---

## 2. Python API Modules

| Package | Domain |
|---------|--------|
| `NXOpen` | Core: Session, Part, NXObject, Expression |
| `NXOpen.UF` | Legacy UF wrappers: UFSession, UFModl, UFPart |
| `NXOpen.Features` | Feature creation: ExtrudeBuilder, CylinderBuilder, HoleBuilder |
| `NXOpen.Assemblies` | Component assembly operations |
| `NXOpen.Drawings` | Drawing sheets and views |
| `NXOpen.Annotations` | Dimensions, notes, PMI, GD&T |
| `NXOpen.CAM` | CAM operations: toolpaths, post-processing |
| `NXOpen.CAE` | FEA/Simulation: mesh, loads, solve |
| `NXOpen.Weld` | Welding features and weld point extraction |
| `NXOpen.Tooling` | Mold and die tooling |
| `NXOpen.Routing` | Piping and routing |
| `NXOpen.BlockStyler` | Custom dialog/UI design |
| `NXOpen.GeometricUtilities` | Geometric helper classes |
| `NXOpen.Positioning` | Constraint-based positioning |
| `NXOpen.MenuBar` | Ribbon/menu customization |
| `NXOpen.Validate` | Validation/check-mate operations |
| `NXOpen.Motion` | Motion simulation / kinematics |
| `NXOpen.ShipDesign` | Ship structure design |

File exchange classes reside in the root `NXOpen` namespace:
- `NXOpen.StepCreator` / `NXOpen.Step214Creator` — STEP export
- `NXOpen.IgesCreator` — IGES export
- `NXOpen.DexManager` — Data exchange manager (factory for exporters/importers)
- `NXOpen.RemoteUtilities` — Remoting support

---

## 3. Platform Support

| Platform | Status |
|----------|--------|
| Windows 11 / Server 2022 | Full support |
| RHEL/Rocky Linux 8.10 | Full support |
| SUSE Linux Enterprise 15 | Full support |
| Ubuntu | NOT officially supported |

**NX Open Python works on all platforms where NX is installed**, including Linux. The `run_journal` utility enables headless batch execution on both Windows and Linux. There is no Windows-only limitation on the Python API.

### Headless / Batch Mode

NX ships with `run_journal` (in `NXBIN/` since NX 11) for headless execution:
- Starts NX in the background with no visible GUI
- Takes a journal file path and arguments, executes it
- Output from the listing window goes to stdout
- A valid NX license IS required for the operations performed
- Works on both Windows and Linux

### Windows-Only Limitations

- **NX Remoting** (.NET Remoting-based client/server) is Windows/.NET Framework only
- **External compiled applications** (.exe using NX Open DLLs) are typically Windows C#/.NET
- Journal recording and `run_journal` work on both platforms

---

## 4. Licensing

| License | What It Provides |
|---------|-----------------|
| Any NX Mach Series | Run journals and NX Open programs (no dev license needed) |
| NX Open Dialog Designer | Build dialogs with NX look-and-feel (UI Styler) |
| NX Open .NET Author | .NET API libraries and documentation |
| NX Open Toolkits Author | Full development toolkit (C++, .NET, Java, Python) |

**Critical finding:** No separate runtime license is required to execute NX Open programs. Execution depends only on the NX feature licenses relevant to the operations performed. Journal recording and playback works without any additional license on all Mach bundles.

### Batch/Automation Usage

No special restrictions on batch or automated usage beyond needing appropriate feature licenses. `run_journal` can be called from cron jobs, CI/CD pipelines, or any process scheduler. Each concurrent NX instance consumes a license seat.

### NX X Token-Based Licensing

The newer NX X model uses value-based licensing (tokens). Programming toolkits are available as token-consuming add-on modules.

---

## 5. Version History and Python Support

| NX Version | Year | Embedded Python | Notes |
|-----------|------|-----------------|-------|
| NX 10 | 2014 | Python 3.3.2 | First Python NX Open support |
| NX 11 | 2016 | Python 3.4.3 | `run_journal` moved to NXBIN |
| NX 12 | 2017 | Python 3.6.x | Last traditional numbered release |
| NX 1847 | 2018 | Python 3.6.x | First continuous release series |
| NX 1899 | 2019 | ~Python 3.6.x | External Python interpreter support added |
| NX 2206 | 2022 | ~Python 3.9.x | New YYMM naming convention |
| NX 2306 | 2023 | ~Python 3.10.x | |
| NX 2406 | 2024 | Python 3.10.11 | **Ships official stub files (.pyi)** |

### External Python Interpreter

From NX 1899+, NX supports configuring an external Python interpreter via environment variables:
- `UGII_PYTHON_LIBRARY_DIR` — path to the external Python shared library
- `UGII_PYTHONPATH` — additional Python path for modules

This enables using external packages (numpy, scipy, pandas, etc.).

### API Backward Compatibility

The API is **additive** between releases — new classes/methods added, old ones rarely removed. The Builder pattern (create builder, set properties, commit) has remained the core paradigm. Scripts written for NX 12 generally work on NX 2406 with minimal changes.

### IDE Support

- **NX 2406+**: Siemens ships official `.pyi` stub files — point IDE to these for full autocompletion
- **Earlier versions**: Use community `nxopentse` package or Eclipse + PyDev with older stubs
- **VS Code**: Add stubs directory to `python.analysis.extraPaths`

---

## 6. Execution Modes

| Mode | GUI | License Required | Use Case |
|------|-----|-----------------|----------|
| Interactive journal (inside NX) | Yes | Base NX | Development, one-off tasks |
| `run_journal` batch mode | No | Base NX | Headless automation, CI/CD |
| NX command-line startup | Yes | Base NX | Automated setup + interactive |
| .NET Remoting | N/A | Toolkits Author | External process control |
| Compiled DLL applications | Yes | Toolkits Author | Production add-ins |

### Batch Mode Command

```bash
# NX 11+
run_journal.exe my_journal.py -args "input.prt" "output.stp"

# Capture output
run_journal.exe my_journal.py > output.log 2>&1
```

---

## 7. Python Limitations vs .NET/C#

- `NXOpenUI` module is **NOT available in Python** — no System.Windows.Forms dialogs
- Python remoting is **not well-documented** — .NET/Java only for remote control
- Performance: adequate for discrete operations; may be slower for millions of small API calls
- Journals must be single-file unless `UGII_PYTHONPATH` is configured for external packages
- Official docs are oriented toward VB.NET — Python examples require manual translation

---

## 8. Code Examples

### Hello World

```python
import NXOpen

def main():
    the_session = NXOpen.Session.GetSession()
    lw = the_session.ListingWindow
    lw.Open()
    lw.WriteFullline("Hello World from NX Open Python!")

if __name__ == '__main__':
    main()
```

### Create a Cylinder Feature

```python
import NXOpen
import NXOpen.Features

def main():
    the_session = NXOpen.Session.GetSession()
    work_part = the_session.Parts.Work

    mark_id = the_session.SetUndoMark(
        NXOpen.Session.MarkVisibility.Visible, "Create Cylinder"
    )

    cylinder_builder = work_part.Features.CreateCylinderBuilder(
        NXOpen.Features.Feature.Null
    )
    cylinder_builder.Diameter.SetFormula("100")
    cylinder_builder.Height.SetFormula("40")
    nx_object = cylinder_builder.Commit()
    cylinder_builder.Destroy()

if __name__ == '__main__':
    main()
```

### Export to STEP 214

```python
import NXOpen
import os

def export_step(output_path):
    the_session = NXOpen.Session.GetSession()
    display_part = the_session.Parts.Display

    step214ug_dir = the_session.GetEnvironmentVariableValue("STEP214UG_DIR")
    settings_file = os.path.join(step214ug_dir, "ugstep214.def")

    step_creator = the_session.DexManager.CreateStep214Creator()
    try:
        step_creator.SettingsFile = settings_file
        step_creator.BsplineTol = 0.001
        step_creator.ExportSelectionBlock.SelectionScope = \
            NXOpen.ObjectSelector.Scope.AnyInAssembly
        step_creator.ObjectTypes.Solids = True
        step_creator.ObjectTypes.Surfaces = True
        step_creator.InputFile = display_part.FullPath
        step_creator.OutputFile = output_path
        step_creator.FileSaveFlag = False
        step_creator.LayerMask = "1-256"
        step_creator.Commit()
    finally:
        step_creator.Destroy()

if __name__ == '__main__':
    export_step("C:\\output\\my_part.stp")
```

### Traverse Assembly Structure

```python
import NXOpen
import NXOpen.Assemblies

def print_components(component, indent=0):
    the_session = NXOpen.Session.GetSession()
    lw = the_session.ListingWindow
    lw.WriteFullline("{}{}".format("  " * indent, component.DisplayName))
    for child in component.GetChildren():
        print_components(child, indent + 1)

def main():
    the_session = NXOpen.Session.GetSession()
    work_part = the_session.Parts.Work
    lw = the_session.ListingWindow
    lw.Open()
    root_component = work_part.ComponentAssembly.RootComponent
    if root_component is not None:
        print_components(root_component)
    else:
        lw.WriteFullline("No assembly structure found.")

if __name__ == '__main__':
    main()
```

### Batch Processing Pattern

```python
import NXOpen
import os

def main():
    the_session = NXOpen.Session.GetSession()
    lw = the_session.ListingWindow
    lw.Open()

    input_dir = "C:\\input"
    for filename in os.listdir(input_dir):
        if filename.endswith(".prt"):
            full_path = os.path.join(input_dir, filename)
            base_part, part_load_status = the_session.Parts.OpenBaseDisplay(full_path)
            part_load_status.Dispose()

            # ... perform operations ...

            lw.WriteFullline("Processed: " + filename)
            base_part.Close(NXOpen.BasePart.CloseWholeTree.TrueValue,
                          NXOpen.BasePart.CloseModified.UseResponses, None)

if __name__ == '__main__':
    main()
```

---

## 9. Automation Capabilities

| Capability | API Support | Strokmatic Relevance |
|-----------|------------|---------------------|
| Parametric model updates | `NXOpen.Expression`, `NXOpen.Features` | Die design iteration |
| BOM extraction | Assembly traversal, component attributes | Cross-product |
| Drawing generation | `NXOpen.Drawings` — sheets, views, dimensions | Cross-product |
| STEP/JT/PDF export | `NXOpen.DexManager`, format-specific creators | Cross-product |
| CAM toolpath generation | `NXOpen.CAM` — operations, tools, post-processing | Die machining |
| Die design automation | NX Progressive Die Wizard, Die Design Wizard | **DieMaster** |
| Weld point extraction | `NXOpen.Weld.AutoPoint`, `WeldManager` | **SpotFusion** |
| Inspection point extraction | `NXOpen.CAM.InspectionOperationCollection` | Quality control |
| FEA/Simulation | `NXOpen.CAE` — mesh, loads, solve, results | Die stress analysis |

### DieMaster Synergies

- Automate die design iteration via parametric updates
- Extract stamping simulation results for sensor correlation
- Generate drawings and BOM automatically for procurement
- CAM toolpath generation for die machining
- NX Progressive Die Wizard API for strip layout, station assignment

### SpotFusion Synergies

- Extract weld point coordinates from NX assemblies (`NXOpen.Weld.AutoPoint`)
- Validate weld plans against CAD geometry
- Export weld specifications for robot programming
- Cross-reference with SpotFusion production data
- Research (Springer 2021): automatic weld path extraction demonstrated for robot code generation

---

## 10. Open-Source Ecosystem

| Project | Stars | Description |
|---------|-------|-------------|
| [NXOpen_Python_tutorials](https://github.com/Foadsf/NXOpen_Python_tutorials) | 77 | Tutorial collection (NX 10-12), CC0 license |
| [nxopentse](https://pypi.org/project/nxopentse/) | 20 | PyPI helper package (cad, cae, tools modules), AGPL-3.0 |
| [NXOpen-CAE-python](https://github.com/theScriptingEngineer/NXOpen-CAE-python) | — | CAE/simulation automation scripts |
| [NXOpen-CAE](https://github.com/theScriptingEngineer/NXOpen-CAE) | 13 | Simcenter 3D journals (primarily C#) |
| [NX Journaling Blog](https://nxjournaling.com/) | — | Most comprehensive community resource |
| [nx-open.com](https://nx-open.com/) | — | NX Open automation programming resource |

The ecosystem is **small but growing**. Python is the fastest-growing language binding. The community lives primarily on Siemens forums, NX Journaling blog, and Eng-Tips rather than GitHub.

---

## 11. MCP Server Architecture

### Feasibility Assessment: HIGH

No existing MCP server for Siemens NX. 9+ MCP servers exist for other CAD platforms (AutoCAD, FreeCAD, SolidWorks, Fusion 360, Onshape).

### Key Constraint

NXOpen Python cannot be imported from an external process. `NXOpen.Session.GetSession()` only works within the NX process. Scripts must run inside NX or via `run_journal`.

### Recommended: Hybrid Architecture

```
                     +--------------------+
                     |   Claude / LLM     |
                     +--------+-----------+
                              |
                     MCP Protocol (stdio/SSE)
                              |
                     +--------v-----------+
                     |   nx-mcp-server    |
                     |  (Node.js/Python)  |
                     +--------+-----------+
                              |
              +---------------+---------------+
              |                               |
     +--------v---------+          +----------v----------+
     | Batch Operations |          | Interactive Bridge   |
     | (run_journal)    |          | (Socket listener     |
     |                  |          |  inside NX session)  |
     | - STEP export    |          |                      |
     | - BOM extraction |          | - Parametric updates |
     | - Drawing gen    |          | - Model queries      |
     | - PDF export     |          | - Feature creation   |
     +------------------+          +----------------------+
```

### Communication Patterns (No Author License Required)

| Pattern | Mechanism | Latency | Best For |
|---------|-----------|---------|----------|
| File-based | MCP writes JSON command, NX journal polls directory | High | Simplest implementation |
| Socket bridge | Persistent NX journal listens on TCP port | Low | Interactive operations |
| run_journal spawn | MCP spawns `run_journal` per operation | Medium | Batch/headless operations |

The socket bridge pattern is proven — it's how the FreeCAD MCP server (`freecad_mcp`) works (socket + JSON on localhost:9876).

### Proposed MCP Tools

1. `export_model` — Export part/assembly to STEP/JT/PDF
2. `extract_bom` — Extract BOM with attributes from assembly
3. `generate_drawing` — Create 2D drawing from 3D model
4. `update_parameters` — Modify parametric dimensions/expressions
5. `extract_weld_points` — Extract spot weld coordinates from assembly
6. `extract_inspection_points` — Extract GD&T/PMI for CMM programming
7. `run_nx_script` — Execute arbitrary NX Open Python journal (sandboxed)
8. `get_model_info` — Query model structure, features, attributes
9. `generate_toolpath` — Create CAM operations with specified parameters
10. `validate_die_design` — Check die design rules and interference

---

## 12. Alternative Approaches

| Approach | License | Platform | Read/Write | Notes |
|----------|---------|----------|-----------|-------|
| NX Open (Python) | NX base | Win/Linux | Full R/W | Primary recommendation |
| JT Open Toolkit | Separate SDK | Win/Linux/Mac | Read-only | Best for visualization without NX license |
| STEP automation (PythonOCC) | Free | Any | Read + limited write | Decoupled from NX, loses parametric data |
| Teamcenter APIs | Teamcenter license | Any | PLM data R/W | Enterprise PLM integration |
| Knowledge Fusion | KF Author addon | Win/Linux | Declarative rules | Rule-based paradigm |
| NX Command-Line Utilities | NX base | Win/Linux | Export only | STEP/IGES/DXF batch translators |

---

## 13. Recommendations

### Immediate (Low effort, high value)

1. **Prototype NX Open batch scripts** — Start with BOM extraction, STEP export, and parametric updates. These work with `run_journal` (no Author license) and provide immediate cross-product value.

### Medium-Term

2. **Build `nx-mcp-server`** — Hybrid architecture using `run_journal` for batch and socket bridge for interactive. Start with the 10 proposed tools. First NX MCP server in the ecosystem.

### Long-Term

3. **LLM-driven NX automation** — Following "From Text to Design" (Cambridge 2025), build an agent that generates NX Open journals from natural language. Siemens' own Design Copilot NX (Dec 2024) validates this direction.

---

## References

- [NXOpen Python API Reference (NX 12)](https://docs.plm.automation.siemens.com/data_services/resources/nx/12/nx_api/custom/en_US/nxopen_python_ref/index.html)
- [NXOpen Python API Reference (NX 10)](https://docs.plm.automation.siemens.com/data_services/resources/nx/10/nx_api/en_US/custom/nxopen_python_ref/index.html)
- [Getting Started with NX Open (PDF)](https://docs.plm.automation.siemens.com/data_services/resources/nx/1872/nx_api/common/en_US/graphics/fileLibrary/nx/nxopen/NXOpen_Getting_Started.pdf)
- [NX Journaling Community](https://nxjournaling.com/)
- [nxopentse on PyPI](https://pypi.org/project/nxopentse/)
- [NXOpen Python Tutorials (GitHub)](https://github.com/Foadsf/NXOpen_Python_tutorials)
- [NX CAD Buyer's Guide — Platform Support](https://plm.sw.siemens.com/en-US/nx/nx-cad-buyers-guide/)
- [NX Stamping Die Design](https://plm.sw.siemens.com/en-US/nx/manufacturing/tooling-fixture-design/stamping-die-design/)
- [NX Progressive Die Design](https://plm.sw.siemens.com/en-US/nx/manufacturing/tooling-fixture-design/progressive-die-design/)
- [NXOpen Weld Path Extraction (Springer 2021)](https://link.springer.com/article/10.1007/s00170-021-07186-0)
- [NX Open Automation — 90% Design Time Reduction](https://dennisklappe.nl/academic-work/nxopen-python-automation)
- [9 MCP Servers for CAD (Snyk)](https://snyk.io/articles/9-mcp-servers-for-computer-aided-drafting-cad-with-ai/)
- [From Text to Design — LLM CAD Agent (Cambridge 2025)](https://www.cambridge.org/core/journals/proceedings-of-the-design-society/article/from-text-to-design/)
- [Siemens Design Copilot NX](https://blogs.sw.siemens.com/nx-design/ai-cad/)
- [NeoApps — Siemens NX Open](https://www.neoapps.de/en/siemens-nx-open/)
- [SWMS — NXOpen Application Extensions](https://www.swms.de/en/blog/application-extensions-for-siemens-nx-with-the-nxopen-interface/)
- [JT Open Toolkit](https://plm.sw.siemens.com/en-US/plm-components/jt/jt-open-toolkit/)
- [NX CMM Inspection Programming](https://plm.sw.siemens.com/en-US/nx/manufacturing/part-quality-control/cmm-inspection-programming/)
- [NXOpen.CAM Package Reference](https://docs.plm.automation.siemens.com/data_services/resources/nx/10/nx_api/en_US/custom/nxopen_python_ref/NXOpen.CAM.html)
- [NXOpen.Weld Package Reference](https://docs.plm.automation.siemens.com/data_services/resources/nx/10/nx_api/en_US/custom/nxopen_python_ref/NXOpen.Weld.html)
- [Generative AI for CAD Automation (arXiv 2025)](https://arxiv.org/html/2508.00843v1)
