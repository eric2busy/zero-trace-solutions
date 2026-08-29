# Production release policy

## Purpose

Zero Trace Solutions uses Vercel Git integration, where merges to `main` trigger Production deployment. Therefore, merge authority is Production release authority.

## Required workflow

1. Workers create changes on a feature branch and open a pull request.
2. Preview deployment and automated checks must be READY/passing before release consideration.
3. Workers stop at the pull request. They do not merge and do not manually deploy to Production.
4. The repository owner approves the exact current PR head with a GitHub comment, rather than a PR review. This supports owner-authored PRs, for which GitHub disallows self-approval.
5. The owner posts exactly `OWNER_PRODUCTION_APPROVED: <current PR head SHA>`. The workflow authenticates the comment author as `eric2busy` and creates the `owner-production-approval` status only on that named SHA.
6. A new commit receives a failing `owner-production-approval` status automatically. The owner must make a fresh comment for the new SHA.
7. Only the repository owner may authorize merge for Production-bound changes.
8. After merge, verify the Vercel Production deployment reaches READY and perform the PR-specific Production smoke checks.
9. If Production verification fails, stop further releases and use the documented rollback path for that PR.

## Important GitHub setting

The status is a hard merge block only when GitHub branch protection or a ruleset requires pull requests and the `owner-production-approval` status check on `main`.

The target repository configuration is:

- Require a pull request before merging to `main`.
- Require status check: `owner-production-approval`.
- Require CODEOWNERS/owner review where the plan supports it.
- Do not allow force pushes or branch deletion for `main`.
- Keep direct Production deployment tied to `main` only.

If this setting is unavailable on the repository plan, the workflow still provides a visible, exact-head gate and the documented process remains the strongest no-cost operational safeguard; GitHub administrators can technically bypass it.

## Permissions and safety

The workflow does not check out or execute PR code. It has only read access to contents and pull requests, plus the narrowly scoped `statuses: write` permission needed to write the required status to the exact PR head.

## Non-goals

This policy does not alter Vercel environment variables, Supabase settings, customer data, billing, or runtime application behavior.
