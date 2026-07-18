# Production deployment

This guide keeps ISTS isolated from unrelated sites and applications.

## Directory layout

```text
/www/wwwroot/ists/
  current/          application checkout
  shared/
    .env.production
    .htpasswd
    data/
```

`current/data` should be a symlink to `shared/data` so deployments never replace
the learner's database or uploads.

## Build

```bash
cd /www/wwwroot/ists/current
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Example production environment:

```env
NODE_ENV=production
PORT=3210
HOSTNAME=127.0.0.1
DATABASE_URL=file:./data/ists.db
UPLOAD_DIR=/www/wwwroot/ists/shared/data/uploads
APP_TIME_ZONE=Asia/Shanghai
AI_PROVIDERS_JSON=
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
NOTION_TOKEN=
NOTION_PARENT_PAGE_ID=
ISTS_BASIC_AUTH_USER=aimer
ISTS_BASIC_AUTH_PASSWORD=use-a-long-random-password
```

If the server already has a working Codex configuration, ISTS can discover it
from `CODEX_HOME` or the service user's `~/.codex`.

## Process

`pnpm build` also creates `.next/standalone`, which is useful when the target
server has slow package-registry access. Build the artifact for the same
operating system and CPU architecture as the server because `better-sqlite3`
contains a native binary.

Do not build the standalone directory directly on Windows and copy it to Linux.
That also breaks pnpm's platform-specific symlink layout. On Windows with Docker
Desktop, export a Linux artifact instead:

```powershell
.\scripts\export-linux-standalone.ps1
```

The script builds the `runner` stage from `Dockerfile`, copies `public` and
`.next/static` into the standalone runtime, and writes a Linux tarball plus its
SHA-256 digest under `output/`.

On the server:

```bash
mkdir -p /www/wwwroot/ists/releases/RELEASE_ID
sha256sum /tmp/ists-linux-standalone-COMMIT.tar.gz
tar -xzf /tmp/ists-linux-standalone-COMMIT.tar.gz \
  -C /www/wwwroot/ists/releases/RELEASE_ID
cd /www/wwwroot/ists/releases/RELEASE_ID
set -a
source /www/wwwroot/ists/shared/.env.production
set +a
node server.js
```

Run `node server.js` under a dedicated process manager for automatic restart.
The database and uploads must remain in `shared/data`, outside the release
directory.

## Nginx

Proxy a dedicated hostname to `127.0.0.1:3210`. The application-level Basic
Authentication variables above protect pages, APIs, exports, and uploaded
files. Nginx authentication can be added as a second layer if desired.

```nginx
server {
    listen 80;
    server_name your-private-hostname.example;

    auth_basic "ISTS private workspace";
    auth_basic_user_file /www/wwwroot/ists/shared/.htpasswd;

    client_max_body_size 30m;

    location / {
        proxy_pass http://127.0.0.1:3210;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Validate Nginx configuration before reloading it.

## Upgrade

1. Back up SQLite and uploads.
2. Pull the new commit.
3. Run `pnpm install --frozen-lockfile` and the validation commands.
4. Build.
5. Restart only the ISTS process.
6. Check `/`, `/coach`, `/practice/reading`, `/writing`, and `/settings`.
