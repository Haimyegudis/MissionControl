# Lumo knowledge bundle

This directory is Mission Control's self-contained, read-only product knowledge bundle. Runtime code resolves it relative to the installed application; it does not require another assistant installation.

- `DB/` contains the Confluence, TestRail, automation-code, TMC-signal, and press-issue vector databases.
- `data/brain/` contains structured knowledge used for fast factual lookups.
- `data/` contains configuration-control exports, the investigation brain database, and source evidence retained for provenance.
- `config/series-config.json` maps press series and programs.
- `manifest.json` records the core database hashes and intended coverage.

Credentials are not part of this bundle. Jira, TestRail, and Confluence access continues to use Mission Control's protected connection settings.
