# Preserved profile source evidence

`dtprime-original.json` preserves the complete pre-migration DTPrime definition,
including its Windows-1251 XML paths and result values, byte for byte from distro
commit 5f8cd424cddbb96bc755a77017d10eb6deed862f. It had no assay mapping rows.
The loaded catalog retains DTPrime as INACTIVE because the Bridge does not
implement that XML format. This release does not claim new XML support. Its
original format definition remains available here for the follow-up implementation;
this directory is not part of the Bridge profile loader pattern.
