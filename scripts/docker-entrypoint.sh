#!/bin/sh
set -eu

uploads_dir="${UPLOADS_DIR:-/tmp/uploads}"

case "$uploads_dir" in
  /*/uploads) ;;
  *)
    echo "[entrypoint] UPLOADS_DIR must be an absolute directory named uploads" >&2
    exit 1
    ;;
esac

mkdir -p "$uploads_dir"
chown visionclaw:visionclaw "$uploads_dir"

if [ "${ISOLATED_STAGING:-0}" = "1" ]; then
  probe="$uploads_dir/railway-persistence-probe.txt"
  if [ -f "$probe" ]; then
    echo "[staging] uploads persistence probe survived restart"
  else
    runuser -u visionclaw -- sh -c 'umask 077; : > "$1"' sh "$probe"
    echo "[staging] uploads persistence probe created by runtime UID 10001"
  fi
fi

exec runuser -u visionclaw -- "$@"