# web/secrets/

Local-only credentials. **Nothing here except this README is committed** (see `web/.gitignore`).

## `google-sa.json` — Google service-account key (for sending email + calendar invites)

Drop the downloaded service-account **JSON key** here as `google-sa.json`.
`web/.env.local` already points to it:

```
GOOGLE_SERVICE_ACCOUNT_JSON=./secrets/google-sa.json
GOOGLE_IMPERSONATE_SUBJECT=<a real @richtechsystem.com mailbox to send "as">
```

`lib/google.js` reads the file (path is resolved from the `web/` dir, where `next dev` runs),
creates a JWT that **impersonates** `GOOGLE_IMPERSONATE_SUBJECT` via domain-wide delegation,
and sends through Gmail.

### What the key needs (one-time, in Google admin)
1. A service account in Google Cloud, with a downloaded JSON key.
2. **Domain-wide delegation** authorized in the Google Workspace Admin Console
   (Security → API Controls → Domain-wide Delegation) for the service account's **Client ID**,
   with scope: `https://www.googleapis.com/auth/gmail.send`
   (add `https://www.googleapis.com/auth/calendar.events` too if you also want calendar invites).
3. `GOOGLE_IMPERSONATE_SUBJECT` set to a real mailbox in the domain (e.g. your own address for testing).

### Production (Azure)
Don't ship the file. Set `GOOGLE_SERVICE_ACCOUNT_JSON` to the **inline JSON** (the whole key, as a
single secret value) — `lib/google.js` accepts either a file path (local) or inline JSON (cloud).
Also set `GOOGLE_IMPERSONATE_SUBJECT` and make sure `AUTH_URL` is the real host.
