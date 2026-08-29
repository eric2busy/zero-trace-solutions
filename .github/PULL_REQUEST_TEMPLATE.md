## Outcome

<!-- Lead with the user or business outcome. -->

Closes #

## Scope

<!-- Summarize the implementation and explicitly name any non-goals. -->

## Acceptance evidence

- [ ] Every issue acceptance criterion is checked with evidence below.
- [ ] Relevant automated tests pass.
- [ ] Manual verification is documented or marked N/A with a reason.

Tests and results:

```text
<command or check> — <result>
```

## Safety and operations

- Failure behavior:
- Rollback plan:
- External side effects and logging: None / describe
- Configuration or environment changes: None / describe
- Customer data involved: None / describe approved handling
- Known limitations: None / describe

## Approval gates

- [ ] No secret, credential, or material customer data is committed.
- [ ] The diff contains no unrelated changes.
- [ ] READY Preview/checks are verification evidence only; they do **not** authorize merge or Production.
- [ ] This PR has not been merged or manually deployed to Production by the worker.
- [ ] Consequential changes are identified below and will not be merged without explicit owner approval.
- [ ] The `owner-production-approval` check passes for the exact current PR head before merge.
- [ ] Required approval links are recorded below, or this PR requires only standard human review.

Vercel release coupling: The current Git integration deploys `main` to Production automatically. An owner merge is therefore the Production release action. Workers stop at READY Preview and do not merge. A new commit after owner review invalidates the prior automated owner gate and requires a fresh owner approval on the new head.

For a consequential PR, the owner approval record must identify this PR/commit and state: `Approved to merge; I acknowledge this merge triggers the Production deployment.`

Consequence level: Low / Medium / High

Required approvals and links: Standard PR review / describe

Owner production verification after merge: N/A / describe the owner-controlled check and rollback trigger

## Worker handoff

- Issue status: Review
- Branch:
- Delivered:
- Verified:
- Owner next action:
