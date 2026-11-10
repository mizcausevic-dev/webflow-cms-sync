# Security Policy

## Reporting a vulnerability

Please open a [private security advisory](../../security/advisories/new) rather than a public issue.

## How this tool handles credentials and data

- The API token is read only from the `WEBFLOW_TOKEN` environment variable. It is never accepted as a CLI argument (that would leak it into shell history and process lists) and never logged.
- Collection IDs are validated as 24-character hex before they are interpolated into request paths.
- Writes are opt-in (`--apply`). Rows that fail schema validation never reach the API. Items that exist only in Webflow are reported, never deleted.
- Link and Image fields accept only `http(s)` URLs, so `javascript:` and similar schemes cannot be written into CMS content.
- The browser playground makes no network calls other than loading its own example files, and it renders everything with `textContent`.
