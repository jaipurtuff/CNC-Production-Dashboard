# CNC File Format Reference & Reverse Engineering Documentation

This document records the exact reverse-engineered specifications for the 4-file CNC job group used by the cutting table software.

---

## 1. Job Group Structure
A CNC job is represented by a set of four files sharing the identical base filename:
- `<JOB_BASE_NAME>.FBT` — Machine execution schedule and sheet completion flags.
- `<JOB_BASE_NAME>.OTD` — OPTIMA S.r.l. 2.5 nesting geometry, piece coordinates, customer, and work order mapping.
- `<JOB_BASE_NAME>.CNI` — ISO G-code machine instructions with mother-sheet dimensions.
- `<JOB_BASE_NAME>.z01` — Binary structured archive containing reference project paths.

Example:
```
18-08-2026-A-06MM_CLEAR------.FBT
18-08-2026-A-06MM_CLEAR------.OTD
18-08-2026-A-06MM_CLEAR------.CNI
18-08-2026-A-06MM_CLEAR------.z01
```

---

## 2. Epistemological Classification: CONFIRMED vs INFERRED vs UNKNOWN

To prevent data corruption and false assumptions, all fields are strictly categorized:

| Category | Definition | Fields |
| :--- | :--- | :--- |
| **CONFIRMED** | Proven through repeated file diffs, explicit headers, and geometry math. | • `[LAST_WRITE]` timestamp in FBT<br>• `DimX`, `DimY`, `Spes` in FBT<br>• Mother sheet dimensions in OTD and CNI (`LX`, `LY`, `LZ`)<br>• OTD Date header (`Tue Sep 01 16:27:07 2026`)<br>• Customer Name, WO No., Pos No. in OTD `[Info]`<br>• Planned optimization waste % |
| **INFERRED** | Empirically derived through snapshot comparisons during active cutting. | • Physical sheet cut completion (detected when `Cnt >= Qta` or flag transitions to `1`)<br>• Cutting timestamp (stored as detection timestamp)<br>• Active vs Paused job status |
| **UNKNOWN** | Internal machine parameters with no published specification. | • CNI `P103=131`, `P012`, `P013`<br>• Undocumented binary bytes in `.z01` (safe string extraction only) |

---

## 3. Detailed File Specifications

### 3.1. .FBT (Production Schedule)
- **Header**: `[LAST_WRITE=DD-MM-YYYY HH:MM:SS]`
- **`[DISTINTA : CAMPI]`**: Field schema definition:
  - `CampoD0=Cod` (Sheet identifier / base name + index)
  - `CampoD1=DimX` (Width in mm)
  - `CampoD2=DimY` (Height in mm)
  - `CampoD3=Spes` (Glass thickness in mm)
  - `CampoD4=Qta` (Programmed quantity)
  - `CampoD5=Cnt` (Cut count)
- **`[DISTINTA : RIGHE]`**: Comma-delimited sheet records:
  ```
  18-08-2026-A-06MM_CLEAR------1,3660,2770,6,1,1,0,1,F6
  ```
  - Pos 0: Sheet code
  - Pos 1: `3660` (DimX mm)
  - Pos 2: `2770` (DimY mm)
  - Pos 3: `6` (Thickness mm)
  - Pos 4: `1` (Programmed qty)
  - Pos 5: `1` (Cut count)
  - Pos 6: `0` (Progress counter / sheet index)
  - Pos 7: `1` (Completion status: 1 = completed, 0 = pending)
  - Pos 8: `F6` (Glass material code)

### 3.2. .OTD (OPTIMA 2.5 Geometry)
- **Header**:
  - `OTDCutVersion=2.5`
  - `Dimension=mm`
  - `Date=Tue Sep 01 16:27:07 2026`
- **Pattern**:
  - `GlassID=F6`
  - `GlassThickness=6.00`
  - `Pieces=12`
  - `Width=3660.00`
  - `Height=2770.00`
- **`[Info]` Records**:
  - `OrderNo`: e.g. `26-27-T01995`
  - `PosNo`: e.g. `61`
  - `Customer`: e.g. `Lingel Windo`
  - `SheetWidth`: e.g. `1281.00`
  - `SheetHeight`: e.g. `639.00`

### 3.3. Date Rule (CRITICAL)
- The filename date (`18-08-2026`) and OTD Date (`Tue Sep 01 16:27:07 2026`) frequently differ.
- **Rule:** The software never converts filename date into production date or physical cutting time. Each timestamp is stored in separate database columns.
