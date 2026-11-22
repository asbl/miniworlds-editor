# Optional classroom backend

The editor is a static application. Editing, Python/Miniworlds execution, local OPFS storage, ZIP import/export,
and the runtime do not require FastAPI. No pupil account, email address, feedback or free-text task answers are added.

## Hosting

The default `public/config.json` has no backend. A missing, invalid or `null` backend address disables the classroom UI
and makes no classroom API requests. To enable it, add the following to the deployed `config.json` (no rebuild needed):

```json
{ "backendUrl": "https://backend.editor.opencoding.de" }
```

Use your own server address for another installation. The URL must be HTTPS; HTTP is accepted for localhost development.
Set `FRONTEND_ORIGINS=https://your-editor.example` on the backend (comma-separated exact origins) and allow that backend
in the frontend host's CSP `connect-src`. `deploy/config.production.json` and `deploy/nginx.conf` configure the production
addresses. They do not change the independent defaults. Pyodide can still be self-hosted using the existing selfhost script.

The editor calls the API directly across origins. It omits cookies, uses the pupil Bearer token only on `/api/play/`
requests, and never adds credentials to a URL. Teacher/admin sessions remain on the backend host. CORS does not replace
authentication. Keep arbitrary origins out of the backend allowlist.

## Opening and saving

“Projekt mit Code öffnen” / “Open project with code” exchanges the code and optional password at `POST /api/claim`.
The server's project becomes a separate local workspace. Every file is included in the save: code in subdirectories,
project configuration, binary assets and databases. `PUT /api/play/save` carries a complete `files` map of relative
paths to Base64, the `main.py` source, optional `save.db`, and `base_revision`. The backend also preserves these files
in copies, submission snapshots, Git history snapshots and ZIP exports. Existing one-file players remain compatible.

Writes go to the local filesystem before synchronization. Only a successful server response advances the saved revision.
Transient failures retry, including after a reload; an authentication failure, exceeded quota or conflict requires action.
Local metadata contains the revision and pending boolean task answers, not complete project files, passwords or tokens.
Tokens and newly issued personal codes live in tab-scoped `sessionStorage` until sign-out/acknowledgment.

A conflict never overwrites either version. Export the local draft using Backup and download the server ZIP to compare.
After securing the draft, sign out and reopen the code to use the server version. Sign-out removes the local server-project
copy, cached task data and credentials. Unsaved changes require explicit confirmation before they can be discarded.
On shared devices, sign out before leaving. Closing a tab alone does not delete OPFS drafts.

The server project uses the normal filesystem interface. Local duplication/export stays available. Browser Git and live
collaboration controls are hidden while editing a server project, to avoid connecting unrelated synchronization systems.
Readonly server projects can be run and exported. File mutations are rejected by both the editor adapter and backend.

## Codes and passwords

Teachers choose between normal project codes and single-use template codes. Each template code creates one new workspace
with its own personal project code. It copies program, files, media and assigned tasks, never the original password,
answers, submissions or access tokens. The consumed code cannot open the original or the copy. The new personal code
is displayed until acknowledged; a first-download failure can be retried with the token kept in the same tab.

Default access expires **365 days after readonly begins** (manual, course archive, inactivity or a scheduled deadline).
Teachers can change the duration, disable that relative limit, or choose a fixed expiry and a “writable until” date.
The earliest applicable expiry wins. A scheduled writable deadline replaces the annual July 31 default for that project.
Extending access does not change data-retention/deletion rules. Expiry also blocks previously issued tokens.

Pupils may protect their workspace with a password of at least 12 characters. Use a long passphrase. Only its Argon2 hash
is stored. Changing the password invalidates every session in that workspace; siblings cannot bypass the protection.
Teachers can reset a forgotten password. Failed code/password attempts are throttled by IP and by a short-lived persisted
code counter (five failures per five minutes). A code remains necessary in addition to the password.

Possible future options, deliberately not enabled automatically:

- **Passkeys/WebAuthn:** strong protection against phishing and guessing, no pupil email required; plan enrollment,
  multiple devices and teacher-assisted recovery before adding them.
- **School OpenID Connect:** useful where a school already provides accounts; store only an opaque subject identifier
  and request minimal claims, because names/emails would conflict with the current data-minimization goal.
- Avoid email magic links and security questions for this setup: they introduce contact data or weak recovery secrets.

## Verification

`npm test` covers configuration, request credentials, local drafts, conflicts, binary files, task drafts, readonly and logout.
`npm run build` validates the production bundle. For the full workflow, install the backend dependencies and Playwright,
then run `python test/backend.py` with the sibling `miniworlds/backend` checkout or `BACKEND_ROOT` set explicitly.
It starts isolated backend/static servers, tests real cross-origin requests and never touches production data.
