# TODOS

Deferred items from CEO review of `claude/flamboyant-buck` (2026-03-23).
Review mode: HOLD SCOPE (Approach A — Targeted Fix).

---

## P2 — Security / Reliability

### [TODO-2] Symlink escape is a NEW problem introduced by the persistence patch
**What:** Add `fs.lstatSync` check in the `/download/` handler to confirm the resolved file path is not a symlink before serving it.
**Why:** Before the persistence patch, there was no startup disk scan. After it, `server.js` loads filenames from `.metadata.json` at startup and resolves them at download time. An attacker who can write to `.metadata.json` (e.g., via a write race) could plant a symlink path pointing outside `uploads/`. The dot-file guard in the plan partially mitigates this but doesn't cover symlink chains.
**Pros:** Closes a NEW attack vector introduced by the persistence patch; `lstatSync` is stdlib.
**Cons:** Extra I/O on every download (negligible for a file sharer).
**Context:** Identified by outside voice (Claude subagent) as a NEW risk, not pre-existing. The review had classified symlink escape as a pre-existing gap out of scope for Approach A — this classification was wrong.
**Effort:** S (human: ~15min / CC: ~5min)
**Priority:** P2
**Depends on:** TODO-1 (apply both in the same download handler hardening pass).

### [TODO-3] CI/CD image tag mismatch breaks docker-compose healthcheck
**What:** Align the Docker image name between the GitHub Actions workflow and `docker-compose.yml`.
**Why:** The workflow pushes `thisisjoyjacob/thisisjoyjacob:openshare-v1.1` but the restored `docker-compose.yml` pulls `thisisjoyjacob/openshare:latest`. Running `docker-compose up -d` pulls a stale or non-existent image — the healthcheck tests a different binary than what CI built.
**Pros:** Makes the docker-compose deployment actually test what CI ships.
**Cons:** Requires a workflow change (`.github/workflows/docker-image.yml`) in addition to the docker-compose restore.
**Context:** Spotted during CEO review system audit. The docker-compose.yml restore (regression fix #2) won't be meaningful until the image names align.
**Fix options:**
  - Option A: Update docker-compose.yml to use `thisisjoyjacob/thisisjoyjacob:openshare-v1.1`
  - Option B: Update the workflow to also push `thisisjoyjacob/openshare:latest` as an alias
**Effort:** S (human: ~10min / CC: ~2min)
**Priority:** P2
**Depends on:** docker-compose.yml restore (regression fix #2).

### [TODO-4] fs.writeFileSync concurrent write corruption in metadata persistence
**What:** Serialize writes to `uploads/.metadata.json` via a write queue or mutex.
**Why:** If two uploads complete near-simultaneously, both call `writeFileSync` on `.metadata.json`. The second write reads stale in-memory state and overwrites the first's changes — one file entry is silently dropped from metadata (the file survives on disk but becomes undownloadable). `inFlightUploads` Set helps but doesn't fully prevent this race.
**Pros:** Eliminates silent data corruption; `async` write queue is zero-deps.
**Cons:** Slightly more complex than `writeFileSync` (adds a queue array + draining loop).
**Context:** Raised by outside voice as a data integrity bug. Review had marked `writeFileSync` as "acceptable for lightweight app" and noted `fs.promises.writeFile` as a drop-in — the drop-in alone doesn't fix the race without a mutex. Approach B territory, but the failure mode is silent and data-losing.
**Implementation sketch:**
  ```js
  let _writeQueue = Promise.resolve();
  function saveMetadata() {
    _writeQueue = _writeQueue.then(() =>
      fs.promises.writeFile(METADATA_PATH, JSON.stringify(fileDatabase))
    );
    return _writeQueue;
  }
  ```
**Effort:** S (human: ~30min / CC: ~5min)
**Priority:** P2
**Depends on:** Patch 4 (persistence) from the design doc.

---

## P3 — Reliability

---

### [TODO-5] Disk space exhaustion — no pre-upload guard
**What:** Check available disk space before accepting an upload; reject with HTTP 507 if below a configurable threshold.
**Why:** A large upload can fill the disk entirely, crashing the server or partially writing a file that corrupts `.metadata.json`. There is no guard today.
**Pros:** Prevents a class of operational failures; `child_process.execSync('df -k uploads/')` is stdlib.
**Cons:** `df` output is platform-dependent (Linux vs. macOS vs. Windows); adds a subprocess per upload.
**Context:** Deferred from Approach B (Complete Hardening). Tracked here so it's not lost. Acceptable risk for Approach A given the lightweight use case.
**Effort:** M (human: ~2h / CC: ~10min)
**Priority:** P3
**Depends on:** Approach B decision.

---

## Completed

### [TODO-1] Null-byte path traversal bypass in /download handler
**Completed:** (2026-03-23) — Implemented in `fix: adversarial review security fixes (download handler)`. Null bytes are now stripped BEFORE the dot-prefix guard (corrected ordering from original implementation where stripping happened after the check, allowing `\0.metadata.json` to bypass).
