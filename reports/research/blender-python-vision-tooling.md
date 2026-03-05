# Research Report: Blender Python (bpy) — Vision Simulation & Synthetic Data

**Date:** 2026-03-05<br>
**Author:** JARVIS Orchestrator<br>
**Status:** Research Complete<br>
**Priority:** Medium<br>

---

## Executive Summary

Blender's Python API (`bpy`) provides complete programmatic control over 3D scenes, materials, lighting, cameras, and rendering. It runs fully headless on Linux and is free/open-source. Strokmatic already has a **production-grade** Blender synthetic data pipeline (`underbody-blender-syndata`) that can be generalized for VisionKing. The field of synthetic data for manufacturing inspection is experiencing **150% year-on-year publication growth** (2023-2024), with proven results showing synthetic-only training data generalizing to real-world images.

---

## 1. Blender Python API Overview

### What is bpy?

The `bpy` module exposes the entire Blender application to Python scripting. Every UI action, data structure, and rendering operation can be controlled programmatically.

### Key Submodules

- **`bpy.data`** — Access to all blend-file data: objects, meshes, materials, cameras, lights, scenes
- **`bpy.context`** — Current active state: active object, selected objects, active scene
- **`bpy.ops`** — All operators: mesh operations, object creation, rendering, import/export
- **`bpy.types`** — Type definitions for all Blender data blocks
- **`bpy.props`** — Property definitions for custom add-ons

### Core Scriptable Operations

| Category | API Module | Examples |
|---|---|---|
| Scene setup | `bpy.data.scenes`, `bpy.context.scene` | Resolution, frame range, world settings |
| Object creation | `bpy.ops.mesh`, `bpy.ops.object` | Primitives, mesh import, duplication |
| Camera control | `bpy.data.cameras`, `bpy.ops.object.camera_add` | Focal length, sensor size, positioning |
| Lighting | `bpy.ops.object.light_add`, `bpy.data.lights` | Point, sun, spot, area lights with energy/color |
| Materials | `bpy.data.materials`, node trees | Principled BSDF, custom shader graphs |
| Rendering | `bpy.ops.render.render`, `bpy.context.scene.render` | Engine selection, output format, resolution |
| Import/Export | `bpy.ops.import_*`, `bpy.ops.export_*` | OBJ, FBX, STL, PLY, glTF |

### Rendering Engines

| Engine | Type | Speed | Quality | Best For |
|---|---|---|---|---|
| **Cycles** | Path-tracing ray tracer | Slow | Physically accurate | Final renders, optical simulation |
| **Eevee** | Real-time rasterizer | Very fast | Good (approximated) | Previews, large-scale data gen |
| **Workbench** | Viewport renderer | Instant | Basic | Debugging, wireframes |

For synthetic data, **Cycles** is the standard for photorealistic results. **Eevee** is used when throughput is prioritized over physical accuracy.

### Minimal Example: Headless Scene Setup + Render

```python
import bpy

bpy.ops.wm.read_factory_settings(use_empty=True)

# Create a metallic sphere
bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=(0, 0, 0))
obj = bpy.context.active_object

# Metallic material
mat = bpy.data.materials.new(name="MetalSurface")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Metallic"].default_value = 1.0
bsdf.inputs["Roughness"].default_value = 0.15
bsdf.inputs["Base Color"].default_value = (0.8, 0.8, 0.85, 1.0)
obj.data.materials.append(mat)

# Area light
bpy.ops.object.light_add(type='AREA', location=(3, -3, 4))
light = bpy.context.active_object.data
light.energy = 500
light.size = 2

# Camera
bpy.ops.object.camera_add(location=(4, -4, 3))
cam = bpy.context.active_object
cam.data.lens = 50
bpy.context.scene.camera = cam

# Render
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 128
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.render.filepath = '/tmp/render_output.png'
bpy.ops.render.render(write_still=True)
```

Run headless: `blender --background --python script.py`

---

## 2. Existing Toolkit: underbody-blender-syndata

Strokmatic already has a production-grade Blender synthetic data pipeline at `visionking/legacy/underbody/underbody-blender-syndata`.

### Capabilities

- Dual-camera simulation (left/right, 1280x1024, configurable focal length 14mm/16mm)
- 5 vehicle colors with weighted distribution and brightness-dependent lighting
- 30+ tracked underbody components with per-component annotation settings
- Procedural defect generation: cable breaks, loose mountings, rotated clips, half-hidden caps
- Production line motion simulation (0.08 m/s conveyor, 3 fps, lateral noise)
- Automatic YOLO-format bounding box annotation with occlusion ray-casting (BVH)
- Material/shader randomization (felt height, rubber color noise, sill plate variants)
- YAML-based configuration for every parameter
- Headless batch rendering: `blender -b project.blend --python-expr "from unsyndata import generator; generator.run_inspection_cycle()"`

### Architecture

```
underbody-blender-syndata/
    src/unsyndata/
        generator.py      — Main orchestration loop (run_inspection_cycle)
        base.py           — Camera class, rendering pipeline, YOLO label generation
        defects.py        — Procedural defect generators
        features/
            interactors.py — Blender scene manipulation, BVH occlusion testing
        settings.py       — YAML config loader, 29 label class definitions
        data/
            organizer.py   — Train/val/test splitting, YOLO data.yaml generation
    parameters.yaml        — Full scene configuration
```

### Core Modules

1. **generator.py** — Main loop: color/shader/light/height randomization, camera lens variation
2. **base.py** — Camera wrapping, per-frame rendering, visibility thresholds, template mesh substitution
3. **defects.py** — `break_cable_defect()`, `mounting_chousing_defect()`, `bundle_clip_defect()`, `cap_half_hidden()`
4. **features/interactors.py** — Mesh retrieval, rotation/position transforms, 2D projection, BVH occlusion testing, YOLO normalization
5. **settings.py** — YAML + env var loading, 29 label classes (OK, AUS, DEF_0/1/2 variants)
6. **data/organizer.py** — Train/val/test split, YOLOv5 config file generation

### Defect Simulation

| Defect Type | Mechanism | Parameters |
|---|---|---|
| Cable break | Random cable orientation (4 templates/side) | ~33% probability |
| Mounting housing | Position noise (0.006-0.026 X-axis) | Loose vs. fitted types |
| Bundle clip | Vertical noise + X/Y rotation (1-23°) | Multi-axis perturbation |
| Cap half-hidden | Realistic occlusion states | BVH ray-casting validation |
| Cap half-mounted | Positioned halfway (partial assembly) | Template mesh swap |
| Component hidden | Not visible in frame | AUS label (~33% probability) |

This toolkit is a solid foundation to generalize for VisionKing surface inspection.

---

## 3. Key Frameworks

| Framework | Stars | Maintainer | Best For |
|-----------|-------|-----------|----------|
| [BlenderProc](https://github.com/DLR-RM/BlenderProc) | 3,400+ | German Aerospace Center (DLR) | Full synthetic data pipeline |
| [BlendTorch](https://github.com/cheind/pytorch-blender) | — | Community | Real-time Blender→PyTorch streaming |
| [Blenderless](https://github.com/oqton/blenderless) | — | Oqton | Easy headless rendering |
| [BlenderDomainRandomizer](https://github.com/gamleksi/BlenderDomainRandomizer) | — | Community | JSON-configured randomization |
| [BladeSynth](https://github.com/MohammedEltoum/bladeSynth) | — | Academic | Aero-engine blade defect inspection |
| [BlenderProc-service](https://github.com/rowdentech/BlenderProc-service) | — | Community | Docker/K8s microservice wrapper |

**BlenderProc** is the industry standard — `pip install blenderproc`, Docker image on Docker Hub, outputs COCO/BOP/YOLO formats natively.

### BlendTorch: Adaptive Domain Randomization

[BlendTorch](https://github.com/cheind/pytorch-blender) provides **bidirectional communication** between Blender and PyTorch:
- Blender generates images with randomized parameters using Eevee (real-time)
- Images stream directly into PyTorch data loaders via ZMQ sockets
- PyTorch sends feedback to adapt randomization based on training loss
- Key finding: "Models trained with BlendTorch repeatedly perform better than those trained on real or photo-realistic datasets"

---

## 4. Optical Simulation Capabilities

Blender's Cycles engine is a physically-based path tracer suitable for geometric optics simulation.

### Industrial Material Simulation

**Metallic surfaces (stamped steel, aluminum):**
```python
bsdf.inputs["Metallic"].default_value = 1.0        # Full metal
bsdf.inputs["Roughness"].default_value = 0.05-0.3   # Polished to brushed
bsdf.inputs["Base Color"].default_value = (R, G, B, 1.0)
```

**Painted surfaces (automotive paint, powder coat):**
```python
bsdf.inputs["Metallic"].default_value = 0.0        # Dielectric base
bsdf.inputs["Base Color"].default_value = paint_color
bsdf.inputs["Coat Weight"].default_value = 1.0     # Full clear coat
bsdf.inputs["Coat Roughness"].default_value = 0.02 # Mirror-like clear coat
```

### Material Parameters for Inspection Simulation

| Parameter | Range | Effect |
|---|---|---|
| Metallic | 0.0 - 1.0 | Dielectric vs. conductor behavior |
| Roughness | 0.0 - 1.0 | Mirror-sharp to fully diffuse |
| Specular IOR Level | 0.0 - 1.0 | Fresnel reflectance strength |
| Coat Weight | 0.0 - 1.0 | Clear coat layer presence |
| Coat Roughness | 0.0 - 1.0 | Clear coat smoothness |
| Anisotropic | 0.0 - 1.0 | Brushed metal direction |
| Normal Map | texture | Surface micro-geometry |

### Lighting Simulation Modes

- **Bright-field illumination** — direct reflection off specular surfaces
- **Dark-field illumination** — catching surface irregularities via scattered light
- **Structured light patterns** — projecting known patterns for 3D reconstruction
- **Coaxial lighting** — light along the camera axis for flat surface inspection
- **Dome lighting** — diffuse illumination from hemisphere

### Limitations

Blender/Cycles is NOT a replacement for dedicated optical tools (Zemax, TracePro, FRED):
- No coherent wave optics (interference, diffraction)
- No polarization simulation
- No exact thin-lens or thick-lens optical models
- No spectral rendering (RGB only, not wavelength-based)
- No photometric calibration (arbitrary intensity units)

Adequate for **geometric optics approximation** and **visual appearance simulation** at zero licensing cost.

---

## 5. Camera Calibration

### Blender↔OpenCV Parameter Conversion

```python
# Blender → OpenCV intrinsic matrix K
f_x = cam.lens / cam.sensor_width * image_width
f_y = f_x * pixel_aspect_ratio
c_x = image_width * (0.5 - cam.shift_x)
c_y = image_height * 0.5 + image_width * cam.shift_y

K = [[f_x,   0, c_x],
     [  0, f_y, c_y],
     [  0,   0,   1]]

# OpenCV → Blender
cam.lens = f_x / image_width * cam.sensor_width
cam.shift_x = -(c_x / image_width - 0.5)  # NOTE: inverted
cam.shift_y = (c_y - 0.5 * image_height) / image_width
```

### BlenderProc Camera Intrinsics API

```python
import blenderproc as bproc

# Set intrinsics from OpenCV K matrix
bproc.camera.set_intrinsics_from_K_matrix(
    K=[[fx, 0, cx], [0, fy, cy], [0, 0, 1]],
    image_width=1920, image_height=1080
)

# Add camera pose (4x4 cam2world matrix)
bproc.camera.add_camera_pose(cam2world_matrix)
```

### Lens Distortion Modeling

BlenderProc implements Brown-Conrady distortion (same as OpenCV):
```python
bproc.camera.set_lens_distortion(
    k1=-0.1, k2=0.01, k3=0.0,  # Radial distortion
    p1=0.001, p2=-0.001          # Decentering distortion
)
```

### Calibration Validation Workflow

```
Real camera calibration (OpenCV/Kalibr)
  → Extract K matrix + distortion coefficients
  → Apply to Blender camera (via BlenderProc API)
  → Render known calibration target (checkerboard)
  → Re-calibrate rendered images with OpenCV
  → Compare recovered parameters with input
  → Validate calibration accuracy
```

---

## 6. Domain Randomization

### Research Finding

A 2024 peer-reviewed study (MDPI Sensors) quantified rendering parameter impact on AI inspection performance:

| Parameter | Accuracy Impact | AUC Impact |
|---|---|---|
| Variable camera position (vs. fixed top-down) | **+9.26 pp** | **+21.53%** |
| HDRI lighting (vs. single top light) | **+11.11 pp** | **+16.04%** |
| Higher noise threshold (0.1 vs. 0.01) | **+5.56 pp** | **+11.98%** |

**Critical finding:** Camera position and lighting variability have **larger impact** on model performance than geometric defect fidelity.

### Randomizable Parameters

| Parameter | Implementation | Impact |
|-----------|---------------|--------|
| Camera position/angle | Random offsets around nominal | Handles mounting tolerances |
| Focal length | Small variations around calibrated value | Handles lens tolerances |
| Lighting intensity/position | Random energy + jitter | Handles aging/installation variance |
| Lighting color | Random color temperature shifts | Handles LED aging |
| Material roughness/color | Random within realistic range | Handles surface wear/batch variation |
| Defect size/position/type | Random placement on surface | Generates diverse defect instances |
| Background/distractor | Random textures or objects | Reduces background bias |
| Post-processing noise | Gaussian noise, blur, chromatic aberration | Simulates sensor noise |
| Exposure/white balance | Random brightness/color shifts | Simulates auto-exposure |

---

## 7. Headless Operation

### Command-Line Rendering

```bash
# Basic headless render
blender --background scene.blend --python render_script.py

# With specific GPU selection
blender --background --python script.py -- --cycles-device CUDA

# BlenderProc headless execution
blenderproc run my_pipeline.py
```

### Required Linux Dependencies (No GUI)

```bash
apt-get install -y \
    libxrender1 libxxf86vm1 libxfixes3 libxi6 \
    libsm6 libgl1 libxkbcommon0 libegl1 \
    mesa-utils libglu1-mesa
```

### Docker Deployment

```bash
# Official BlenderProc Docker image (GPU-accelerated)
docker run --gpus all \
    --user $(id -u) \
    -v $(pwd):/data \
    blenderproc/blenderproc \
    blenderproc run /data/my_pipeline.py
```

### GPU Rendering Options

| Mode | Engine | Speed | Setup |
|---|---|---|---|
| GPU (CUDA) | Cycles | Fast | NVIDIA GPU + drivers |
| GPU (OptiX) | Cycles | Fastest | RTX GPU + OptiX |
| CPU | Cycles | Slow but always available | Any server |
| GPU (Eevee) | Eevee | Very fast | OpenGL 3.3+ |

For 10,000+ images at 1920x1080 with Cycles, expect 2-8 hours on an RTX 3090/4090.

### Batch Generation Pattern

```bash
# Launch 10 parallel batch jobs across 4 GPUs
for i in $(seq 0 9); do
    docker run --gpus "device=$((i % 4))" -d \
        -v /data:/data \
        blenderproc/blenderproc \
        blenderproc run /data/pipeline.py $i &
done
```

---

## 8. ML Pipeline Integration

### Output Formats

| Format | Content | Target Framework |
|---|---|---|
| **COCO JSON** | Bounding boxes, segmentation masks, keypoints | Detectron2, MMDetection |
| **BOP** | 6D pose annotations | BOP benchmark models |
| **YOLO TXT** | Normalized bounding boxes | YOLOv5/v8/v11 (Ultralytics) |
| **HDF5** | RGB + depth + normals + segmentation | Custom pipelines |

The existing `underbody-blender-syndata` outputs YOLO format directly. BlenderProc outputs COCO natively.

### COCO to YOLO Conversion

```python
from ultralytics.data.converter import convert_coco

convert_coco(
    labels_dir="/data/output/coco_annotations/",
    save_dir="/data/output/yolo_labels/",
    use_segments=True
)
```

### Complete Pipeline: Blender to YOLO Training

```
1. CAD model + defect definitions
2. BlenderProc pipeline script
   → Load CAD, apply materials, place defects, randomize, render 10k+ images
3. Format conversion (COCO JSON → YOLO TXT)
4. YOLOv11 training: yolo detect train data=data.yaml model=yolo11n.pt epochs=100
5. Evaluation on real-world test set (mAP, precision, recall, sim-to-real gap)
```

---

## 9. Proven Industrial Results

| Industry | Application | Key Finding |
|----------|------------|-------------|
| Semiconductor | Wafer scratch detection (2026) | YOLO trained purely on synthetic data generalized to real images |
| Steel manufacturing | Surface defect classification (2021) | 6 defect types successfully generated |
| Injection molding | Flash defect detection (2024) | Domain-randomized data outperformed fixed-viewpoint by 9+pp |
| Aerospace | Turbine blade inspection (2025) | 12,500 synthetic images via BladeSynth |
| Assembly | SME visual QC (2025) | BlenderProc + YOLOv11 end-to-end pipeline |

### Key Benchmark

**BlendTorch (2021):** Models trained with adaptive domain randomization via BlendTorch outperformed models trained on real or photo-realistic datasets in industrial object detection tasks.

**Domain Randomization for Manufacturing (arXiv 2025):** Material texture randomization (metal, plastic, fingerprints) degenerates performance less than fixing it — validates the randomization approach for industrial applications.

---

## 10. VisionKing Application Areas

| Capability | Description | Value |
|-----------|------------|-------|
| Vision setup analysis | Simulate camera placements, FOV coverage, blind spots | Pre-installation optimization |
| Reflection angle calibration | Ray-trace specular reflections on steel surfaces | Optimize lighting for defect visibility |
| Synthetic data generation | Domain-randomized defect images with auto-annotation | Address class imbalance, bootstrap new defect types |
| Camera calibration validation | Simulate multi-camera setup, verify detection coverage | Validate before physical deployment |
| Lighting optimization | Find optimal illuminator positions/energy | Minimize glare, maximize defect contrast |
| New product bootstrapping | Generate training data before production starts | Accelerate deployment on new lines |

### Implementation Considerations

- **Material modeling:** Steel bar surfaces require metallic BSDF with roughness 0.15-0.40. Surface oxidation and scale simulated with texture overlays.
- **Defect geometry:** Scratches, dents, irregularities modeled as displacement maps, bump maps, or geometric mesh modifications.
- **Lighting replication:** VisionKing's actual lighting setup should be measured and replicated in Blender for maximum sim-to-real fidelity.
- **NX Open integration:** CAD models exported from Siemens NX via STEP can be imported into Blender for vision simulation.

### Combined NX Open + Blender Pipeline

```
NX (CAD model) → STEP export (NX Open) → Blender import →
    Vision simulation + Synthetic data generation (bpy) →
    YOLOv11 training → VisionKing deployment
```

---

## 11. Recommended Architecture

```
tools/blender-synth/
    pipeline/
        generate_defects.py      # Main BlenderProc pipeline
        materials.py             # Steel/metal material definitions
        defect_library.py        # Procedural defect generators
        camera_config.py         # VisionKing camera parameters
        lighting_config.py       # VisionKing lighting setup
    models/
        steel_bar.obj            # Base geometry
        fixtures.obj             # Conveyor/fixture geometry
    configs/
        domain_randomization.json
        camera_calibration.json
    scripts/
        run_batch.sh             # Docker batch launcher
        convert_to_yolo.py       # COCO → YOLO conversion
    Dockerfile
```

---

## 12. Recommendations

### Immediate (High value, existing foundation)

1. **Generalize underbody-blender-syndata** — Extract domain-agnostic components (camera simulation, material randomization, YOLO annotation) into a reusable framework under `tools/blender-synth/`. The existing code covers ~80% of what's needed.

### Medium-Term

2. **Build `blender-synth-mcp-server`** — Wrap BlenderProc + the generalized VisionKing pipeline as MCP tools for on-demand synthetic data generation, camera simulation, and lighting optimization.

3. **VisionKing camera/lighting optimizer** — Build a Blender scene matching VisionKing's physical setup and use it to systematically evaluate camera positions and lighting angles before installation.

### Long-Term

4. **Adaptive synthetic data pipeline** — Integrate BlendTorch for real-time adaptive domain randomization, where the training pipeline's loss signal guides Blender's data generation toward difficult scenarios.

---

## References

### Official Documentation
- [Blender Python API](https://docs.blender.org/api/current/index.html)
- [Blender Python API Quickstart](https://docs.blender.org/api/current/info_quickstart.html)
- [Principled BSDF — Blender Manual](https://docs.blender.org/manual/en/latest/render/shader_nodes/shader/principled.html)
- [Camera(ID) — Blender Python API](https://docs.blender.org/api/current/bpy.types.Camera.html)

### Frameworks
- [BlenderProc (GitHub)](https://github.com/DLR-RM/BlenderProc)
- [BlenderProc Documentation](https://dlr-rm.github.io/BlenderProc/)
- [BlenderProc Camera API](https://dlr-rm.github.io/BlenderProc/blenderproc.api.camera.html)
- [BlenderProc Lens Distortion](https://dlr-rm.github.io/BlenderProc/examples/advanced/lens_distortion/README.html)
- [BlenderProc Docker Hub](https://hub.docker.com/r/blenderproc/blenderproc)
- [BlenderProc-service (Docker microservice)](https://github.com/rowdentech/BlenderProc-service)
- [BlendTorch / pytorch-blender](https://github.com/cheind/pytorch-blender)
- [Blenderless (headless rendering)](https://github.com/oqton/blenderless)
- [BlenderDomainRandomizer](https://github.com/gamleksi/BlenderDomainRandomizer)
- [BladeSynth Source Code](https://github.com/MohammedEltoum/bladeSynth)

### Research Papers
- [Synthetic Training Data in AI-Driven Quality Inspection (Sensors 2024)](https://pmc.ncbi.nlm.nih.gov/articles/PMC10820774/)
- [Synthetic Data Generation for Steel Defect Detection (MDPI 2021)](https://www.mdpi.com/2073-8994/13/7/1176)
- [BladeSynth: Aero Engine Blade Defect Inspection (Nature 2025)](https://www.nature.com/articles/s41597-025-05563-y)
- [Wafer Inspection with Synthetic Data and YOLO (Springer 2026)](https://link.springer.com/article/10.1007/s41060-026-01034-8)
- [Procedural Synthetic Training Data for Surface Inspection (ScienceDirect)](https://www.sciencedirect.com/science/article/pii/S2212827122003997)
- [BlendTorch: Adaptive Domain Randomization (Springer)](https://link.springer.com/chapter/10.1007/978-3-030-68799-1_39)
- [Domain Randomization for Manufacturing (arXiv 2025)](https://arxiv.org/html/2506.07539v1)
- [Blender-COCO Pipeline Enhancing YOLOv8 (SIBGRAPI 2025)](https://sol.sbc.org.br/index.php/sibgrapi/article/view/39104)
- [Synthetic Data with Blender Benchmark (CVPR 2023)](https://openaccess.thecvf.com/content/CVPR2023/papers/Tang_A_New_Benchmark_On_the_Utility_of_Synthetic_Data_With_CVPR_2023_paper.pdf)
- [Synthetic Data Pipeline for Manufacturing SMEs (arXiv 2025)](https://arxiv.org/html/2509.13089)

### Tools and Integrations
- [Blender↔OpenCV Camera Conversion](https://www.rojtberg.net/1601/from-blender-to-opencv-camera-and-back/)
- [OpenCV Camera Calibration + Blender](https://github.com/paulmelis/opencv-camera-calibration)
- [Blender-OpenCV Camera Calibration](https://github.com/Engnation/blender-opencv-camera-calibration/)
- [Ultralytics JSON2YOLO Converter](https://github.com/ultralytics/JSON2YOLO)
- [Hugging Face — BlenderProc Tutorial](https://huggingface.co/learn/computer-vision-course/en/unit10/blenderProc)

### Defect Detection Resources
- [Surface-Defect-Detection Database (GitHub)](https://github.com/Charmve/Surface-Defect-Detection)
- [Awesome Industrial Anomaly Detection](https://github.com/M-3LAB/awesome-industrial-anomaly-detection)
- [Metal Defect Datasets Collection](https://github.com/halmusaibeli/metal-defect-datasets)
- [NVIDIA Omniverse Replicator (commercial alternative)](https://developer.nvidia.com/blog/how-to-train-a-defect-detection-model-using-synthetic-data-with-nvidia-omniverse-replicator/)
