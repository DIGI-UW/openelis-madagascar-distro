# FluoroCycler migration acceptance

`mock-results.xlsx` is copied byte-for-byte from analyzer-mock commit
6df789111d26a122a440892e478b358c8c4738b4, fixtures/fluorocycler-xt/results.xlsx.
It has no assay column: the profile-owned VIH-1 default must preserve all four
observations across its two accessions, including the separate Valid rows.

`synthetic-all-assays.xlsx` is explicit synthetic regression data covering every
retained mapping code, including distinct case-sensitive Mpox spellings, and one
profile-recognized control after saved activation and process-state restart.
Row codes override the per-file default. These are software compatibility checks,
not vendor qualification or physical-instrument evidence.
