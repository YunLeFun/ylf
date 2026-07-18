# @yunlefun/server-session-cloudbase

CloudBase NoSQL adapter for `@yunlefun/server-session`.

The adapter accepts the official CloudBase Node SDK database object through a structural contract. Install and initialize the current `@cloudbase/node-sdk` in the server runtime; it is an optional peer so this package never silently installs a second SDK copy.

It stores session documents and a bounded per-user active-session index in the server-only `ylf_app_sessions` collection. All state transitions use CloudBase Node SDK transactions; query-based sweeper discovery runs outside those transactions because CloudBase transactions support document operations, not `where()` queries.

The checked-in manifest is declarative only. Creating the collection, indexes, and security rules is an explicit production operation and must be reviewed separately.
