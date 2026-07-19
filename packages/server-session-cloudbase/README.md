# @yunlefun/server-session-cloudbase

CloudBase NoSQL adapter for `@yunlefun/server-session`.

The adapter accepts the official CloudBase Node SDK database object through a structural contract. Install and initialize the current `@cloudbase/node-sdk` in the server runtime; it is an optional peer so this package never silently installs a second SDK copy.

It stores session documents and a bounded per-user active-session index in the server-only `ylf_app_sessions` collection. All state transitions use CloudBase Node SDK transactions; query-based sweeper discovery runs outside those transactions because CloudBase transactions support document operations, not `where()` queries.

Schema v2 records `terminatedAt` for bounded 90-day cleanup and supports transactional app-scoped global revocation. The sweeper remains backward-readable with schema v1; legacy terminal records use a conservative absolute-expiry fallback and are never deleted before the configured retention window.

The checked-in manifest is declarative only. Creating the collection, indexes, and security rules is an explicit production operation and must be reviewed separately.
