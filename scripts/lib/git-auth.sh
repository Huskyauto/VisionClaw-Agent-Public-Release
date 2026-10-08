#!/usr/bin/env bash
# Run one GitHub git operation without putting a credential in a URL, argument,
# log, or disk file. The short-lived askpass script reads the inherited secret.
with_github_auth() (
  local token askpass_dir
  token=$(printf '%s' "${GITHUB_PERSONAL_ACCESS_TOKEN_2:-${GITHUB_TOKEN:-}}" | tr -d '[:space:]')
  if [ -z "$token" ]; then
    echo "git-auth: no GitHub token available" >&2
    return 2
  fi
  askpass_dir=$(mktemp -d) || return 5
  trap 'rm -rf "$askpass_dir"' EXIT
  umask 077
  cat > "$askpass_dir/askpass" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  *Username*) printf '%s\n' x-access-token ;;
  *Password*) printf '%s\n' "$VC_GIT_TOKEN" ;;
  *) exit 1 ;;
esac
EOF
  chmod 700 "$askpass_dir/askpass"
  export VC_GIT_TOKEN="$token" GIT_ASKPASS="$askpass_dir/askpass" GIT_TERMINAL_PROMPT=0
  "$@"
)