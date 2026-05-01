# Analyzer file converters

Standalone host-side preprocessors that normalize vendor-specific analyzer
exports into the shape the bridge's generic `FileResultParser` expects.
**Out of scope of the release/deploy path** — these are run on-demand by lab
IT, not by the stack itself.

## Why ship these in the deployment distro?

Three Madagascar-fleet analyzers (FluoroCycler XT, Multiskan FC, Tecan F50)
emit files in vendor-specific shapes that the bridge cannot consume directly:
each uses a 96-well plate-grid layout where sample IDs and result values live
on separate sheets (or separate row-blocks within one sheet), instead of the
flat well-per-row table the bridge expects.

Two adapter patterns were considered:

| Approach | Pros | Cons |
|---|---|---|
| **Adapt at the bridge** — add per-vendor parsers to `FileResultParser` | One artifact, no host-side step | Couples bridge release cycle to vendor-specific weirdness; new analyzer = bridge release |
| **Adapt at the host** — converter CLIs that produce a profile-conformant CSV | Bridge stays generic; new vendor = new script, no bridge release | Lab IT must run the converter before drop-into-watched-folder |

The host-side approach was chosen because it keeps the bridge generic and
bounded. **These scripts are the productionization of that choice** — without
them, these three analyzers cannot be onboarded against the standard bridge
build, even though their data is valid lab output.

If the lab eventually moves to vendors with structured exports, the
corresponding script becomes obsolete and can be removed. Until then, they
ship with the distro because the distro is what the lab pulls when standing
up a site.

## Scripts

### convert-fluorocycler-legacy.py

```
python3 scripts/converters/convert-fluorocycler-legacy.py HIV-result.xlsx
python3 scripts/converters/convert-fluorocycler-legacy.py HIV-result.xlsx -o FC-XT_HIV-result.xlsx
```

- **Input**: 6-column copy-paste workbook from FluoroSoftware (`Row | Col | Sample ID | Type | Calc. Conc. | Result`)
- **Output**: standardized 13-column FC-XT template defined in OGC-420 (`SampleID | WellPosition | AssayName | TargetName | TargetNo | CP | Interpretation | CalcConc | CalcConcUnit | RunDate | RunID | Notes | Type`)
- Splits compound `Calc. Conc.` strings (e.g. `2.10E6 copies/mL = 6.32 log copies/mL`) into numeric + unit
- Profile consumed by: [../../configs/analyzer-profiles/file/fluorocycler-xt.json](../../configs/analyzer-profiles/file/fluorocycler-xt.json)

### convert-multiskan-skanit.py

```
python3 scripts/converters/convert-multiskan-skanit.py INPUT.xlsx
python3 scripts/converters/convert-multiskan-skanit.py INPUT.xlsx --test-code "HIV ELISA"
```

- **Input**: SkanIt "temporary" export — single sheet with two stacked plate grids (absorbance grid at row 10, sample-ID grid at row 20; French locale: "Échantillon", "Blanc", "NC", "PC")
- **Output**: flat well-per-row CSV (`WellPosition, SampleID, Abs, TestCode`), semicolon-delimited per the profile's French-locale `configDefaults`
- Profile consumed by: [../../configs/analyzer-profiles/file/multiskan-fc.json](../../configs/analyzer-profiles/file/multiskan-fc.json)

### convert-tecan-magellan.py

```
python3 scripts/converters/convert-tecan-magellan.py INPUT.xlsx
python3 scripts/converters/convert-tecan-magellan.py INPUT.xlsx --test-code "HIV ELISA"
```

- **Input**: custom Magellan workbook — `Plan_plaque` sheet holds sample-ID grid (with NEG/POS QC labels), `DO_palque` sheet holds OD_450 values (`palque` typo preserved from lab template)
- **Output**: flat well-per-row CSV (`WellPosition, SampleID, OD_450, TestCode`); QC wells get a `QC_` TestCode prefix
- Profile consumed by: [../../configs/analyzer-profiles/file/tecan-f50.json](../../configs/analyzer-profiles/file/tecan-f50.json)

## Requirements

- Python ≥ 3.10 (uses PEP 604 union type syntax — `str | None`)
- `openpyxl` (`pip install openpyxl`)

The scripts run on the host, not inside any container. They have no
dependency on the running stack.

## Operational placement

```
analyzer  →  USB / shared drive  →  host  →  converter  →  watched folder  →  bridge → OE
```

The watched folder is whatever path is mounted into the bridge container as
the per-analyzer input directory (declared in `compose.yaml`). The converter
writes its output CSV directly there, and the bridge picks it up on its next
scan.

For automation, lab IT can wrap a converter in a per-analyzer `inotifywait`
rule that triggers on files dropped into a "raw" folder and writes the
converted output into the bridge's watched folder.
