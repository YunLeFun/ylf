# @yunlefun/server-session

Reusable opaque application sessions for YunLeFun server runtimes.

- Persists only SHA-256 token identifiers and safe device metadata.
- Enforces idle and absolute expiry, rotation, revocation, and a concurrent-session cap.
- Exposes a framework-neutral `SessionStore` transaction boundary.
- Provides H3 helpers for `__Host-` cookies, exact Origin checks, and session-bound HMAC CSRF.

This package is deliberately separate from `@yunlefun/sso`: SSO proves identity once; this package owns each application's durable, revocable session. CloudBase access/refresh tokens and COS credentials must never be stored in an `AppSession`.
