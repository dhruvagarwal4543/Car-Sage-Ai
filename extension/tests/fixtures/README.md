# Real-page fixtures

Trimmed copies of six public pages, fetched on 2026-10-30 with a plain GET (no login, no access control bypassed). Source URLs: `sources.json`.
Each file keeps the page's own JSON-LD (reviews, seller/dealer and street details and long lists removed), canonical link, `og:image`, the `<h1>`, and the first 6000
characters of visible text. Running the detector on these gives the same result as on the full pages (checked when they were made).

They are a snapshot: the sites change their markup and prices. When the tests start failing after a refresh, re-fetch the page and check the new markup before editing the adapter.
