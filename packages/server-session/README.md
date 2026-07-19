# @yunlefun/server-session

Reusable opaque application sessions for YunLeFun server runtimes.

- Persists only SHA-256 token identifiers and safe device metadata.
- Enforces idle and absolute expiry, rotation, per-device/revoke-others/global-security-event revocation, and a concurrent-session cap.
- Exposes a framework-neutral `SessionStore` transaction boundary.
- Provides H3 helpers for `__Host-` cookies, exact Origin checks, and session-bound HMAC CSRF.

The framework-neutral root export has no H3 runtime requirement. Install `h3@^1.15.11` only when using `@yunlefun/server-session/h3`; the safe minimum excludes known request-smuggling and path-traversal releases.

This package is deliberately separate from `@yunlefun/sso`: SSO proves identity once; this package owns each application's durable, revocable session. CloudBase access/refresh tokens and COS credentials must never be stored in an `AppSession`.

`revokeAllForUser({ appId, userId })` is the app-scoped security-event primitive. Account compromise, password reset, administrative suspension, or identity-provider risk signals should call it for every affected application; it never broadens one app's session authority into another app.
