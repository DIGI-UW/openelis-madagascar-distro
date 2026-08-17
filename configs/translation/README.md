# Deployment translation overrides

Files here override the UI's bundled translations, so this deployment can reword
any string in the interface without rebuilding the frontend image.

Overriding is **on** for this deployment:
`OVERRIDE_DEFAULT_TRANSLATION=true` in
`../properties/SystemConfiguration.properties`.

The files below carry the **same wording the application already ships**, so
turning it on changed nothing that anyone can see. They are a working starting
point: edit a value and that string changes, and nothing else does.

Two things follow from setting it in the properties file rather than the UI:

- It **wins over** Admin -> Site Information Menu
  (`/MasterListsPage/SiteInformationMenu`, the `overrideDefaultTranslation`
  row), so the toggle there cannot switch it off while this line is present.
- Changing the line needs a backend restart. Comment it out if you would rather
  drive the setting from the UI, which takes effect immediately.

## Files

One JSON file per locale, named exactly as the UI's own bundles — the
underscored form, which is also what Transifex emits:

```
en.json   fr.json   mg.json   fr_MG.json
```

Ship only the locales you customize. A locale with no file here keeps its
shipped bundle. `mg.json` and `fr_MG.json` are the ones this deployment is most
likely to want; neither is shipped here yet.

Overriding is **per message id**, not per file. `en.json` and `fr.json` here each
name a single id, so at most one string is affected and every other message keeps
the wording it shipped with. You never copy a whole bundle to change one line.

A regional locale also picks up its base language: a user on `fr_MG` gets
`fr.json` layered under `fr_MG.json`, so rewording `fr.json` alone still reaches
them.

## How it is wired

`docker-compose.yml` mounts this directory into the frontend container at
`/usr/share/nginx/html/translation`, which the UI reads as
`/translation/<locale>.json`.

A change to a file already here takes effect on the next browser reload — nginx
serves it from disk on every request, so no restart and no rebuild. Adding a
locale file that was not here before is picked up the same way.

Point this deployment's own Transifex project at this directory to keep it in
step with its translation workflow.
