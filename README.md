# Scalable Brain live

A public, read-only view of a private quantitative research and trading platform. It shows service health, the data model and the research record, using real data and no login.

## How it works

```text
Private systems --> export job --> safety check --> GitHub "data" branch --> static page
                    (one way, about every 5 minutes)
```

- `exporter/export.py` reads private systems using read-only database sessions and writes one small JSON file.
- `validate()` refuses to publish a file with an unknown field, a private-looking value, or the name of a strategy still under test.
- The `data` branch holds a single rolling commit, so it keeps no public history.
- The page is static. It has no server or database, and no way to connect back to the private systems.

No credentials are stored in this repository. The export job reads them from the private machine it runs on.

## Embed

```html
<iframe src="https://emmanuelebube13.github.io/scalablebrain-live/?embed=1"
        title="Scalable Brain live system view"
        style="width:100%;height:900px;border:0" loading="lazy"></iframe>
```

Add `&theme=light` to start in the light theme.

## Tests

```text
python exporter/test_export.py
```

For information only. Not financial advice, and not a claim of trading returns.
