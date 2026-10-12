#!/usr/bin/env bash
# Safe sync: working copy -> delivered folder.
#
# Guards against the real incident this project had: a DIFFERENT chat edited the
# delivered folder (added the Lock Lid template), and a plain `rsync` from this
# chat's working copy would have silently erased that work. Two protections:
#
#   1. TAMPER CHECK — at the end of every sync, a manifest of sha256 checksums of
#      the delivered files is written to `<delivered>/.sync-manifest`. The next
#      run recomputes and compares BEFORE syncing. Any file changed, added or
#      removed since the last sync means someone else worked in the folder: the
#      script prints exactly which files and ABORTS. Merge those changes into the
#      working copy first (or rerun with --force to overwrite anyway — backups
#      are still taken).
#
#   2. BACKUPS — every file the sync would overwrite or delete is first copied,
#      with its relative path preserved, into
#      `<delivered>/_claude_backups/<UTC timestamp>_pre-sync/`.
#
# Usage: sync-to-delivered.sh <working-copy> <delivered> [--force]
# First run (no manifest yet) just backs up + syncs + writes the baseline.
set -euo pipefail

SRC="${1:?usage: sync-to-delivered.sh <working-copy> <delivered> [--force]}"
DST="${2:?usage: sync-to-delivered.sh <working-copy> <delivered> [--force]}"
FORCE="${3:-}"

MANIFEST="$DST/.sync-manifest"
BACKUP_ROOT="$DST/_claude_backups"
STAMP="$(date -u +%Y-%m-%d_%H%MZ)_pre-sync"

# Everything transient or chat-local stays out of both the sync and the manifest.
# .DS_Store and launcher.log are runtime artifacts the USER'S machine creates just
# by opening the folder / running the launcher app — they are not source changes
# and must never trip the tamper check.
EXCLUDES=(
  --exclude node_modules --exclude 'dist*' --exclude release --exclude '*.tsbuildinfo'
  --exclude _claude_backups --exclude .sync-manifest
  --exclude .DS_Store --exclude launcher.log
  --exclude raw-check.ts --exclude brute-fold.ts --exclude 'verify-a4-bleed.ts'
  --exclude verify-dimensions.ts --exclude debug-dims.ts --exclude check-dim-ids.ts
  --exclude verify-dims-fix.ts --exclude verify-uv.ts --exclude chk.ts
  --exclude verify-final.ts --exclude verify-flaps.ts --exclude verify-leftflap.ts
  --exclude orient.ts --exclude neg.ts
)

list_files() { # relative paths of tracked files in $1
  (cd "$1" && find . \
    -path ./node_modules -prune -o -path './dist*' -prune -o -path ./release -prune -o \
    -path ./_claude_backups -prune -o \
    -name '*.tsbuildinfo' -prune -o -name .sync-manifest -prune -o \
    -name .DS_Store -prune -o -name launcher.log -prune -o \
    -type f -print | sed 's|^\./||' | LC_ALL=C sort)
}

checksum_all() { # "sha256  relpath" lines for $1
  list_files "$1" | while IFS= read -r f; do
    printf '%s  %s\n' "$(sha256sum "$1/$f" | cut -d' ' -f1)" "$f"
  done
}

# ---- 1. tamper check -------------------------------------------------------
if [[ -f "$MANIFEST" ]]; then
  CURRENT="$(checksum_all "$DST")"
  if ! diff <(cat "$MANIFEST") <(printf '%s\n' "$CURRENT") > /tmp/manifest.diff 2>&1; then
    echo "!! DELIVERED FOLDER CHANGED SINCE THE LAST SYNC — someone else (another chat, or you) worked in it."
    echo "!! Files that differ from the recorded manifest:"
    # '<' lines: state at last sync; '>' lines: state now.
    grep -E '^[<>]' /tmp/manifest.diff | awk '{print "     " $1 " " $3}' | sort -u -k2 | head -40
    if [[ "$FORCE" != "--force" ]]; then
      echo "!! ABORTING. Merge these into the working copy first, or rerun with --force (backups are still taken)."
      exit 1
    fi
    echo "!! --force given: proceeding anyway. Everything overwritten is backed up."
  fi
else
  echo "No manifest found in the delivered folder — first safe sync. Establishing baseline."
fi

# ---- 2. back up everything this sync would change --------------------------
CHANGED="$(rsync -a --delete --dry-run --itemize-changes "${EXCLUDES[@]}" "$SRC/" "$DST/" \
  | awk '$1 ~ /^[<>ch.*]|^\*deleting/ {print $2}' | grep -v '/$' || true)"

if [[ -n "$CHANGED" ]]; then
  BACKUP_DIR="$BACKUP_ROOT/$STAMP"
  N=0
  while IFS= read -r f; do
    [[ -f "$DST/$f" ]] || continue          # new files have nothing to back up
    mkdir -p "$BACKUP_DIR/$(dirname "$f")"
    cp -p "$DST/$f" "$BACKUP_DIR/$f"
    N=$((N + 1))
  done <<< "$CHANGED"
  echo "Backed up $N file(s) to _claude_backups/$STAMP/"
else
  echo "Nothing to change — delivered copy already up to date."
fi

# ---- 3. sync + record the new baseline --------------------------------------
rsync -a "${EXCLUDES[@]}" "$SRC/" "$DST/"
checksum_all "$DST" > "$MANIFEST"
echo "Synced. Manifest updated ($(wc -l < "$MANIFEST") files tracked)."
