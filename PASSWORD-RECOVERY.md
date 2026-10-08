# Password recovery deployment
The recovery UI is at /recuperar. Sending stays disabled until all three environment settings exist:
- PUBLIC_APP_URL: exact trusted HTTPS origin, for example https://bellezaai-server.onrender.com (no path/query/fragment).
- RESEND_API_KEY: server-only sending key.
- RECOVERY_EMAIL_FROM: a verified sending address owned by the operator.

Do not use the owner's email password. Do not expose the API key to browser code. Configure sender-domain verification in the provider before enabling. No email has been sent by development tests.

Tokens are random 256-bit values stored only as SHA-256 digests. Expiry: 30 minutes; one use. Link secrets travel in URL fragments, are removed immediately, and remain only in page memory. Reload requires reopening the email. Password change increments the account session version; authenticated routes check it against the database, revoking existing tokens. Legacy JWTs without version remain valid only for version-zero accounts.

Requests return the same 202 message before account lookup/provider delivery. Delivery errors are logged without address/token details. A provider outage can therefore prevent mail despite an accepted request. Requests are throttled per process (5/email/15min, global and concurrency bounds), plus a persistent 15-minute per-account mail cooldown. An additional shared/global limiter is needed for many server instances. Email sending runs after the response; a restart can interrupt it. The user can request another link after cooldown; no durable delivery queue yet.

Validation uses a fake injected mail transport only in the integration test (no environment switch to expose reset tokens). PostgreSQL and HTTP are real. Production sender delivery and browser interaction still require verification once mail is configured.
