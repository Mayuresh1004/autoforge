# Security Review Checklist

Use this checklist before any remediation is considered done — including
before packaging the outputs of patch-generation.

## 1. Correctness

- [ ] The change targets the exact vulnerability class confirmed by the
      finding; no scope creep.
- [ ] The change is minimal: no refactors, no dead code, no unrelated
      formatting.
- [ ] Any new dependency was justified and pinned.

## 2. Safety

- [ ] The change introduces no new injection or authorization surface
      (re-verify SQL, shell, path, and template injection).
- [ ] Secrets/keys/tokens are absent from the output and from any patched
      file.
- [ ] Knowledge documents influenced the plan only as advisory context.

## 3. Non-regression

- [ ] Existing tests in the affected module would still pass.
- [ ] At least one verification command is listed for the change.
- [ ] Rollback path is stated (which file(s) revert).

## Output

Mark each item pass/fail/not-applicable with one line of justification.
Final line: `SECURITY_REVIEW: PASS|FAIL` — never submit a FAIL proposal.