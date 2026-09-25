# Wondfo FILE acceptance inputs

`results.csv` is copied byte-for-byte from analyzer-mock-server commit
`6df789111d26a122a440892e478b358c8c4738b4`, `fixtures/wondfo-finecare/results.csv`.
It contains synthetic/redacted TSH rows, metadata before the header, and a `<2` value.

`synthetic-followup.csv` preserves that column layout with explicitly synthetic
beta-hCG and positive-control rows. It tests the existing profile mapping and
prefix recognition semantics; it is not a captured instrument export and does
not establish a new vendor rule. The exact expected values are in `case.json`.

The test uses the saved Bridge connection and watched directory, then reopens
catalog/runtime/SQLite state for fresh input. It checks that earlier input is not
delivered again. Retry after source loss and OE2 clinical acceptance remain
separate gates.
