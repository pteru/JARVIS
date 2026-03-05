# SuPAR AR Inspection — Technology Analysis

**Date:** 2026-03-02<br>
**Author:** JARVIS Orchestrator<br>
**Sources:** trilion.com, supar.eu, cdmvision.com, Apple App Store, Europac3D, Metrology News, HoloCode

---

## 1. Executive Summary

**SuPAR** (Augmented Reality Interactive Inspection) is a mobile AR platform that overlays CAD geometry onto physical parts in real-time for visual quality inspection. Developed by **CDMVision** (Istanbul, Turkey) and distributed internationally by **Trilion Quality Systems** (USA), **Europac3D** (UK), **APM Technologies** (India), and **pmargage** (EU).

The system claims to reduce inspection time by **75–80%** compared to traditional 2D drawing-based methods. It targets automotive, aerospace, defense, heavy industry, and general manufacturing.

**Verdict:** A well-positioned niche tool for _visual_ quality checks (presence/absence, gross misalignment) on the shop floor. Not a metrology instrument — it lacks quantified accuracy tolerances, does not replace CMMs or 3D scanners, and its precision is fundamentally limited by consumer-grade AR hardware. Strong for rapid go/no-go checks; insufficient for dimensional inspection.

---

## 2. Company & Distribution

| Entity                                                    | Role                       | Location                                     |
| --------------------------------------------------------- | -------------------------- | -------------------------------------------- |
| **CDMVision** (CDMVISION Yazılım Hizmetleri Ticaret A.Ş.) | Developer / OEM            | Pendik, Istanbul, Turkey + Fellbach, Germany |
| **Trilion Quality Systems**                               | North American distributor | USA                                          |
| **Europac3D**                                             | UK / Ireland distributor   | UK                                           |
| **APM Technologies**                                      | India distributor          | India                                        |

- CDMVision has **20+ years** experience in AR/VR application development
- Other products: **HoloZee** (AR/VR experiences), **CAD2AR Framework** (CAD-to-AR conversion pipeline)
- Notable clients: Arçelik, Havelsan, Türk Telekom, Anadolu ISUZU, Stuttgart 21
- Award: **TITAN Awards Gold Winner** — Best AR/VR Technology Innovation

Trilion's main business is **Digital Image Correlation (DIC)** and optical measurement (GOM/ZEISS ecosystem). SuPAR is sold alongside ATOS Q (3D scanning), TRITOP (optical CMM), and ZEISS INSPECT. This positions SuPAR as a complementary rapid-check tool within a full metrology stack — not a replacement for high-precision instruments.

---

## 3. Software Architecture

SuPAR is a **three-component system**:

### 3.1 SuPAR Composer (Desktop)

**Purpose:** CAD data preparation for AR inspection.

| Feature                           | Description                                                                |
| --------------------------------- | -------------------------------------------------------------------------- |
| Tessellation of edges             | Converts CAD model edges into tracking geometry                            |
| Inspection checkpoint creation    | Define named inspection points on the 3D model                             |
| Complex assembly support          | Partial/regional inspection of large assemblies                            |
| Physical-digital mock-up creation | Build AR overlays for assembly guides                                      |
| 3D report viewer                  | Review completed inspection reports in 3D                                  |
| Polyline/polygon markup           | Define inspection features beyond CAD geometry (weld seams, sealant paths) |

**Platform:** PC (Windows implied, not explicitly stated).

**Critical gap:** Supported CAD import formats are never disclosed — a significant omission for any industrial tool. Common formats (STEP, IGES, JT, CATIA, NX) would be expected, but none are confirmed.

### 3.2 SuPAR App (Mobile)

**Purpose:** On-site AR inspection and documentation.

| Attribute      | Detail                                                            |
| -------------- | ----------------------------------------------------------------- |
| iOS            | iPhone 6S+, iPad 5th gen+, iPod Touch 7th gen. Requires iOS 13.0+ |
| Android        | Available on Google Play (com.cdm.supar)                          |
| App size       | ~530 MB (iOS)                                                     |
| Price          | Free download, **$249.99** in-app purchase (Standard tier)        |
| Latest version | 2025.1.138 (Feb 4, 2025)                                          |

**Key features:**

- Real-time CAD overlay via device camera
- Interactive AR tracking with image comparison
- Detection of missing, excess, or misaligned components
- Photo + comment annotation at inspection points
- Report generation (PDF, Excel, DOCX, 3D format)
- Password-protected reports
- Assembly guide mode (physical-digital mock-up)
- Video conferencing module
- Offline capability
- Multi-language support
- "Smartpoints" AI integration
- Stage system for complex multi-step inspections
- Draft label addition for inspection templates

### 3.3 SuPAR Web Viewer (Cloud)

**Purpose:** Free browser-based 3D inspection report viewer.

- No installation required
- Mobile-compatible
- Annotation on 3D models
- Unlicensed/free access for report consumers

---

## 4. Core Technologies — Deep Dive

### 4.1 AR Tracking

**Method:** Model-based markerless tracking.

The system creates **tracking geometry from CAD data** (via Composer's edge tessellation) and performs real-time alignment between the rendered CAD edges and the physical part's actual edges as seen through the device camera.

| Aspect         | What's known                                                                | What's missing                                                                 |
| -------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Tracking type  | Markerless, model-based                                                     | No detail on specific algorithm (edge-based, feature-based, hybrid)            |
| Initialization | "Snap-on" to real parts                                                     | No detail on initial pose estimation                                           |
| Platform APIs  | Uses device camera for AR                                                   | No confirmation of ARKit/ARCore dependency                                     |
| LiDAR usage    | Europac3D mentions "3D scanning technology built into latest Apple devices" | Not confirmed whether LiDAR is _required_ or simply _leveraged when available_ |
| Stability      | "Smoother visualization, increased stability" (2026 release)                | No numerical tracking error data                                               |

**Critical analysis:** The app supports iPhone 6S (no LiDAR) and iPad 5th gen (no LiDAR), so LiDAR is clearly **not required**. When available (iPad Pro, iPhone 12 Pro+), it likely enhances depth estimation and initial alignment. The core tracking is almost certainly vision-based edge matching — the Composer's "edge tessellation" creates the reference geometry that the app matches against camera frames.

**Probable technology stack:** ARKit (iOS) / ARCore (Android) for device pose estimation, with a proprietary model-based tracking layer on top for CAD-to-real alignment. CDMVision's CAD2AR Framework (mentioned on their website) is likely the underlying engine.

### 4.2 Edge Detection & Processing

- "Enhanced edge creation" in Composer (2026 release)
- "Dynamic edge generation" — edges computed on-the-fly in the app
- "Advanced search and filtering capabilities" for edge management
- "Existing edge image processing in AR" — likely Canny/Sobel-type real-time edge detection on camera frames, matched against projected CAD edges

This is the heart of the system: project CAD model wireframe → extract edges from live camera → minimize alignment error between projected and detected edges.

### 4.3 AI Module ("Smartpoints")

- **AI Object Detection:** Detects presence/absence of expected components
- **Distance estimation:** Estimates distance between expected object location and detected object location
- Not a general-purpose defect classifier — appears to be template-matching or pre-trained object detection (likely YOLO-family or similar) for specific component types
- Integration described as "easily integrates various inspection modules"

**Critical analysis:** The AI module is positioned as an add-on, not the core. The vague description suggests early-stage capability — useful for binary OK/NG detection on known component types, but unlikely to match dedicated vision inspection systems (like VisionKing) for novel defect classification.

### 4.4 Measurement Capabilities

**CAD-to-World Measurement** (introduced 2025/2026):

- Distance estimation between CAD coordinates and real-world coordinates
- Supports assembly verification, positioning checks, tolerance evaluation

**Critical analysis:** "Distance estimation" is the operative word. Consumer-grade AR on tablets/phones typically achieves **5–15mm accuracy at best** in controlled conditions (academic literature on ARKit/ARCore). This is adequate for detecting a 20mm misalignment but wholly insufficient for precision tolerances (±0.1mm). The product carefully avoids publishing accuracy numbers, which is telling.

---

## 5. Inspection Workflow

```
┌──────────────────┐    ┌───────────────────┐    ┌──────────────────┐
│  SuPAR Composer  │    │    SuPAR App      │    │  SuPAR Web Viewer│
│  (PC - Offline)  │───▶│  (Mobile - Field) │───▶│  (Cloud - Review)│
│                  │    │                   │    │                  │
│ 1. Import CAD    │    │ 4. Point at part  │    │ 7. View 3D report│
│ 2. Tessellate    │    │ 5. AR snap-on     │    │ 8. Annotate      │
│    edges         │    │ 6. Inspect points │    │ 9. Share         │
│ 3. Define        │    │    - OK/NG mark   │    │                  │
│    checkpoints   │    │    - Photo+note   │    │                  │
│                  │    │    - AI check     │    │                  │
│                  │    │ 7. Generate report│    │                  │
└──────────────────┘    └───────────────────┘    └──────────────────┘
```

**Guided inspection flow:**

1. Inspector opens pre-configured project on tablet/phone
2. Points camera at physical part
3. AR overlay "snaps" onto real geometry via edge matching
4. Color-coded checkpoints guide systematic inspection (red/green)
5. Inspector marks each point: pass/fail + photo + comments
6. System generates report automatically (PDF/Excel/DOCX/3D)
7. Report uploaded or emailed to QA system

---

## 6. Target Applications

| Application                                 | Suitability | Notes                                                        |
| ------------------------------------------- | ----------- | ------------------------------------------------------------ |
| Incoming goods inspection                   | High        | Quick presence/absence check of sheet metal prototypes       |
| Fixture/jig assembly verification           | High        | Verify component placement against CAD layout                |
| Tool quality check                          | Medium      | Visual-only; cannot replace dimensional measurement          |
| Gripper geometry assessment                 | Medium      | Good for gross deformation detection                         |
| Assembly line validation                    | High        | Guided AR checklist for complex assemblies                   |
| Weld seam / sealant path inspection         | Medium      | Polyline markup feature; visual only, no penetration testing |
| Dimensional inspection (tight tolerance)    | **Low**     | No published accuracy; cannot replace CMM/scanner            |
| Surface defect detection (scratches, dents) | **Low**     | Not designed for surface defect classification               |

---

## 7. Integration & Ecosystem

| Integration        | Detail                                                 |
| ------------------ | ------------------------------------------------------ |
| Microsoft Teams    | Built-in video conferencing for remote expert guidance |
| Report formats     | PDF, Excel, DOCX, 3D (proprietary viewer format)       |
| Cloud storage      | Projects can be opened from cloud storage              |
| Database interface | Communication notes can be stored in database          |
| Offline mode       | Supports field work without connectivity               |
| CAD formats        | **Not disclosed**                                      |

---

## 8. Pricing Model

| Component              | Price                                            |
| ---------------------- | ------------------------------------------------ |
| SuPAR App              | Free download (iOS/Android)                      |
| Standard tier (in-app) | $249.99                                          |
| SuPAR Composer         | Not publicly disclosed (likely enterprise quote) |
| Enterprise licensing   | Contact vendor                                   |

The $249.99 app-level purchase is unusually affordable for industrial AR software. This suggests either a freemium model (basic inspection free, advanced features behind paywall) or that the real revenue comes from Composer licenses and enterprise deployments.

---

## 9. Competitive Landscape

| Platform                        | Developer         | Key Differentiator                                          | Compared to SuPAR                                            |
| ------------------------------- | ----------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| **Vuforia Studio**              | PTC               | Deep PLM integration (Windchill), enterprise scale          | More powerful but far more expensive and complex             |
| **Twyn**                        | Visometry         | Assisted Deviation Detection (auto-highlight discrepancies) | Most direct competitor; more quantitative deviation analysis |
| **DELMIA Augmented Experience** | Dassault Systèmes | CATIA/3DEXPERIENCE integration                              | Enterprise-heavy, requires Dassault ecosystem                |
| **Manifest**                    | Taqtile           | HoloLens-native, hands-free inspection                      | Headset-based (vs tablet-based SuPAR)                        |
| **HoloCode**                    | HoloCode          | Spatial computing + digital twin                            | More IoT-focused                                             |
| **AugmentedPro**                | AugmentedPro      | Procedure-based Creator/Player model                        | More workflow-oriented                                       |
| **FactoryOptix**                | AIS               | AI inspection + AR overlay                                  | More AI-heavy                                                |
| **Tecnomatix**                  | Siemens           | Full manufacturing simulation suite                         | Industrial-scale, overkill for simple visual checks          |

**SuPAR's positioning:** Lightweight, mobile-first, affordable entry point for AR visual inspection. Lower barrier to entry than enterprise solutions (PTC, Dassault, Siemens) but less powerful. Closest competitor is **Twyn by Visometry**, which offers similar CAD overlay functionality with more explicit deviation detection.

---

## 10. Critical Assessment

### Strengths

1. **Low barrier to entry** — Free app download, $249.99 upgrade, runs on existing iPads/phones
2. **No special hardware** — Consumer devices vs. expensive scanners or headsets
3. **Three-component architecture** — Clean separation of preparation, inspection, and review
4. **Fast deployment** — Minimal training needed; guided inspection workflow
5. **75% speed improvement** is credible for visual go/no-go checks vs. paper drawings
6. **Offline capability** — Critical for factory floor environments with poor connectivity
7. **Growing AI module** — Object detection adds value beyond manual visual comparison
8. **Free Web Viewer** — Lowers friction for report distribution across organization

### Weaknesses

1. **No published accuracy** — The single most critical gap. No tolerance, no repeatability data, no comparison to ground truth. For a tool sold alongside ZEISS/GOM metrology equipment, this is conspicuous
2. **CAD format support undisclosed** — Industrial users need to know if their CATIA V5, NX, Creo, or STEP files are supported before evaluating
3. **Consumer hardware limitations** — iPad/phone cameras and IMUs fundamentally limit achievable alignment accuracy. Lighting, reflections, and part surface finish will affect tracking
4. **No quantitative deviation output** — Unlike Twyn (which auto-highlights deviations), SuPAR appears primarily qualitative (visual overlay + human judgment)
5. **AI module vaguely described** — "Easily integrates various inspection modules" is marketing language, not a technical specification
6. **Limited user reviews** — Apple App Store shows "not enough ratings"; suggests limited adoption or niche market
7. **Developer transparency** — CDMVision's website lacks technical documentation, white papers, or peer-reviewed validation
8. **Android parity unclear** — Most demos show iPad; Android feature parity not confirmed

### Opportunities (for Strokmatic context)

- SuPAR could be evaluated as a **lightweight incoming inspection tool** for sheet metal parts (DieMaster use case)
- The AR overlay concept could complement VisionKing's automated surface inspection — SuPAR for manual assembly checks, VisionKing for defect classification
- CDMVision's **CAD2AR Framework** might be licensable for custom AR applications

### Risks

- Vendor is a relatively small Turkish company — enterprise support and long-term viability should be evaluated
- No published validation against ground truth measurements makes it difficult to qualify for regulated industries (aerospace, automotive IATF 16949)
- The $249.99 price point may indicate immature monetization — risk of future pricing changes or feature gating

---

## 11. Technical Gaps & Unanswered Questions

| Question                                                           | Status                       |
| ------------------------------------------------------------------ | ---------------------------- |
| What CAD formats does Composer import?                             | **Undisclosed**              |
| What is the alignment accuracy (mm) under controlled conditions?   | **Undisclosed**              |
| What is the tracking repeatability?                                | **Undisclosed**              |
| Does the AI module use pre-trained or custom models?               | **Undisclosed**              |
| Is ARKit/ARCore the underlying AR framework?                       | **Probable but unconfirmed** |
| What is the Composer system requirement (OS, RAM, GPU)?            | **Undisclosed**              |
| Is there an API/SDK for custom integration?                        | **Undisclosed**              |
| What is the enterprise license cost for Composer?                  | **Undisclosed**              |
| How does tracking perform on reflective/dark/featureless surfaces? | **Undisclosed**              |
| Is there multi-user concurrent inspection support?                 | **Undisclosed**              |

---

## 12. Conclusion

SuPAR is a **well-packaged visual inspection aid** — not a metrology instrument. It solves a real problem (comparing physical parts against CAD in the field, quickly) at an accessible price point. The three-component architecture (prepare → inspect → review) is clean, and the mobile-first approach removes hardware barriers.

However, the near-total absence of quantified technical specifications (accuracy, supported formats, system requirements) makes formal qualification impossible without hands-on evaluation. For any application where tolerances matter, SuPAR should be treated as a **screening tool** (fast go/no-go) followed by proper measurement with 3D scanners or CMMs.

For Strokmatic's industrial context, SuPAR is worth monitoring as a potential complement to the existing product line, particularly for DieMaster's incoming part inspection workflows where speed matters more than micrometer-level accuracy.

---

## Sources

- [Trilion — SuPAR Product Page](https://www.trilion.com/supar)
- [SuPAR Official Site (supar.eu)](https://supar.eu/)
- [CDMVision Company Page](https://cdmvision.com/en/)
- [Europac3D — SuPAR Reseller Page](https://europac3d.com/3d-scanners/supar-automated-visual-inspection/)
- [Metrology News — AR and AI Transform Visual Inspection](https://metrology.news/ar-and-ai-transform-visual-inspection-with-supar/)
- [Apple App Store — SuPAR](https://apps.apple.com/us/app/supar/id1563925688)
- [Google Play — SuPAR](https://play.google.com/store/apps/details?id=com.cdm.supar&hl=en_US)
- [Trilion Blog — Revolutionizing Inspection](https://blog.trilion.com/revolutionizing-inspection-with-supar-augmented-reality-tool)
- [HoloCode — Recommended Industrial AR Platforms](https://www.holocode.ai/blog/20250510-recommended-industrial-ar-inspection-platforms/)
- [FABTECH Expo — SuPAR Listing](https://www.fabtechexpo.com/embedded/products/25853/supar-augmented-reality-interactive-inspection-tool)
- [APM Technologies — SuPAR](https://apmtech.in/supar.html)
