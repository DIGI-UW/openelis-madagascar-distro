# Madagascar analyzer catalog

Bridge loads the distro catalog directly from its read-only `/app/analyzer-profiles`
mount. `BRIDGE_PROFILE_CATALOG_SHIPPED_PATTERN` selects every current and historical
revision. The existing persistent Bridge state volume holds saved connections,
locally authored revisions, and the delivery outbox. OpenELIS reads the catalog
from Bridge; no manual profile copying or API import is required.

The catalog contains 20 profile families and 31 revisions. Nineteen families are
active. DTPrime remains inactive because XML parsing was already unsupported; its
complete original definition is retained in
[analyzer-profile-source-data/dtprime-original.json](analyzer-profile-source-data/dtprime-original.json).
The 11 previously published GeneXpert ASTM, FluoroCycler, and QuantStudio revisions
are retained byte-for-byte. Existing connections keep their revision pins; updates
to the latest definition require explicit profile selection and local binding review.

## Required compatibility

Bridge 3.2.3 supports explicitly unconfigured control recognition and a saved or
profile-default FILE assay selection. Five migrated HL7 profiles use explicit
empty rules because their previous definitions provided none. This does not mean
that instruments never send controls. Their recognition evidence is NOT_EVALUATED,
and their prior unclassified result behavior is preserved. The corresponding
OpenELIS catalog/display fix is tracked in
[OpenELIS PR #4425](https://github.com/DIGI-UW/OpenELIS-Global-2/pull/4425).
Do not describe those profiles as control-qualified.

FluoroCycler retains its full assay menu; a profile-owned VIH-1 fallback supports
existing exports without a target column. A saved selection can override this
fallback, and an explicit row code takes precedence. QuantStudio retains all 17
codes and uses Quantity Mean followed by CT when quantity is blank. No mappings
are merged merely because their LOINC codes coincide.

Incoming network traffic uses shared listeners: host port 12000 for ASTM LIS1-A
and 2575 for HL7/MLLP. An individual incoming analyzer port is not required.
Source host/sender ownership still identifies the saved connection. Optional
outbound destinations use the existing Bridge/profile fallback behavior.

## Release checkpoints

1. Run `scripts/check-analyzer-catalog.sh /path/to/pinned-bridge`. The exact source
   pin in `configs/analyzer-catalog-manifest.json` must be clean. Bridge's real
   validator and loader must find exactly 20 families and retain every historical
   fingerprint.
2. Run `scripts/check-analyzer-runtime.sh /path/to/pinned-bridge`. Every active
   profile must have a case covering saved activation, real socket or watched-file
   input, normalized HTTP delivery, exact result assertions, and saved restart.
   Expectations and input fixtures are in `tests/analyzer-catalog/`.
3. Pin the published Bridge image by digest. Validate Compose after creating
   `.env` from `.env.example`. Confirm the catalog mount, persistent Bridge state,
   shared listeners, and matching delivery/health host.
4. Publish only after PR checks pass. The release workflow repeats catalog and
   runtime checks and validates the catalog and Compose file from the actual
   extracted release archive before publishing it.

These checks exercise software compatibility with synthetic data and pinned mock
fixtures. They do not establish clinical qualification or physical-instrument
acceptance. DTPrime XML, native Tecan/Multiskan plate-grid conversion, and physical
serial reconnection remain documented follow-ups. The release supports the tested
flat export formats; it does not claim native grids are interchangeable with them.
