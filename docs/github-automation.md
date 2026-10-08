# GitHub automation credential contract

The source-backup and CI self-healer workflows use the secure Replit Secret
`GITHUB_PERSONAL_ACCESS_TOKEN_2` as their preferred repository credential.
The existing `GITHUB_TOKEN` fallback remains supported; no other credential
name is part of the automation contract.

The credential must be allowed to:

- read and write repository contents on `Huskyauto/VisionClaw-Agent`;
- read GitHub Actions workflow runs and job metadata.

For a classic GitHub Personal Access Token, this is the `repo` scope. For a
fine-grained token, grant the repository `Contents: Read and write` and
`Actions: Read-only` permissions.

`ENABLE_SELF_PUSH=1` is a separate shared, non-secret switch that enables the
already-configured Auto Git Push workflow. It does not contain credential
material.

Run the non-destructive recovery check with:

```sh
bash scripts/github-automation-healthcheck.sh
```

The check performs one read-only repository probe and one read-only Actions
run-list API request. A passing probe proves authenticated repository read/list
access and Actions run-list access; it does not itself prove write permission
or failed-job log download. The actual Auto Git Push success and the
self-healer's successful repair/verification logs provide those separate
end-to-end checks. Never place the token in source code, logs, commits, or
chat.