# Local deployment and optional Linux packaging

IELTS Studio is a private workspace for one learner. The supported release
workflow is cloning the source and running it locally. Node.js 24 is recommended;
Windows users can double-click `start.bat`. See [README_LOCAL.md](../README_LOCAL.md).
No AI account is required for the offline learning features.

## Run from source on Linux or macOS

Use the committed npm lockfile, not the upstream project's old pnpm commands:

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm start
```

Open `http://127.0.0.1:3000`. `npm start` binds to loopback. The first run creates
`data/ists.db` and `data/uploads/`; each clone has its own local learning records.
The public NGSL/NAWL courses and original sample exercises work without private
PDFs or `data/vocabulary-private-catalog.json`. Private course packages and
imported material must be supplied separately by their owner.

SQLite and PDF rendering use native Node modules. Run `npm ci` on the target
operating system and CPU architecture; do not copy Windows `node_modules` to
Linux. If a native prebuilt binary is unavailable, install the platform's native
build tools and retry. No Linux or macOS source launch was executed as part of
this Windows release validation.

## Optional Docker runtime

The Dockerfile uses Node.js 24, `npm ci`, an ordinary `next build`, and
`next start`. It does not require `output: standalone`. Only explicit public
source inputs are copied; personal `data/`, `work/`, `.env` files and Git history
are not included. The runtime retains the full Linux `node_modules` and the
public learning pack with its source manifest and licence.

**Docker was not available on the Windows machine used for this release. This
optional image and Linux archive have been reviewed but not built or started
there; validate them on your Docker installation before relying on them.**

```bash
docker build --target runner -t ielts-studio .
docker volume create ielts-studio-data
docker run --rm --name ielts-studio \
  -p 127.0.0.1:3000:3000 \
  --mount type=volume,source=ielts-studio-data,target=/app/data \
  ielts-studio
```

The service listens on `0.0.0.0:3000` **inside the container** so Docker can
forward traffic. The example publishes the host port only on `127.0.0.1`, not
the LAN or internet. Persist `/app/data` across container replacement. A named
volume inherits the image's writable data-directory ownership; an existing
Linux bind mount must be writable by the container's `node` user (UID 1000).
Do not mount your production data for a disposable image test.

For a container smoke test, verify `/api/health`, both public courses, a new
vocabulary learning card, one local PDF import, and a backup export. Stop and
recreate the container with the same volume, then verify the records remain.

## Optional full Linux runtime archive

The historical helper filename remains available for existing callers:

```powershell
.\scripts\export-linux-standalone.ps1
```

Despite that filename, it now exports a **complete Linux runtime**, not a Next.js
standalone bundle. It builds the Docker runner and writes
`output/ielts-studio-linux-runtime-COMMIT.tar.gz` plus a reported SHA-256 digest.
The archive includes `.next`, Linux `node_modules`, `public`, the public learning
pack, the package files, `next.config.ts`, and the software licence. Its allowlist
excludes all databases, uploads, private packages, and environment files.

Use Linux with matching architecture and Node.js 24 to run the archive:

```bash
mkdir -p ielts-studio-runtime
tar -xzf ielts-studio-linux-runtime-COMMIT.tar.gz -C ielts-studio-runtime
cd ielts-studio-runtime
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000
```

The container's `/app/data` environment settings are not embedded in the archive;
without environment overrides this command creates `data/` beside the extracted
runtime. Keep that directory outside future replacement archives, or configure
absolute `DATABASE_URL=file:/path/to/ists.db` and `UPLOAD_DIR=/path/to/uploads`.
Load any AI configuration privately on the target host. Codex fallback is opt-in.

## Updates and private hosting

Before updating, export a complete backup and stop the application. Update the
code, run `npm ci` when the lockfile changes, rebuild, and restart while retaining
`data/` and private configuration. Check the health endpoint, vocabulary, recent
writing, and uploaded materials. Do not run `git clean -xfd` in a personal install.

Public GitHub source distribution does not imply a shared online learning service.
For deliberate private internet hosting, configure both `ISTS_BASIC_AUTH_USER`
and `ISTS_BASIC_AUTH_PASSWORD`, HTTPS, and persistent storage before exposing
the application. There is still only one learner profile; the application does
not provide account registration or isolation between multiple learners.
