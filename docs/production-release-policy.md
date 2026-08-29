# Production release policy

## Purpose

Zero Trace Solutions uses Vercel Git integration, where merges to `main` trigger Production deployment. Therefore, merge authority is Production release authority.

## Required workflow

1. Workers create changes on a feature branch and open a pull request.
2. Preview deployment and automated checks must be READY/passing before release consideration.
3. Workers stop at the pull request. They do not merge and do not manually deploy to Production.
4. The repository owner reviews the exact current PR head commit.
5. The `owner-production-approval` check must pass on that exact head. A new commit invalidates the prior approval and requires a fresh owner review.
6. Only the repository owner may authorize merge for Production-bound changes.
7. After merge, verify the Vercel Production deployment reaches READY and perform the PR-specific Production smoke checks.
8. If Production verification fails, stop further releases and use the documented rollback path for that PR.

## Approval language

For consequential changes, the owner approval record should state:

`Approved to merge; I acknowledge this merge triggers the Production deployment.`

## Important GitHub setting

The workflow check is only a hard merge block when GitHub branch protection or a ruleset requires pull requests and the `owner-production-approval` status check on `main`.

Until that repository setting is enabled, this policy plus the visible check is the operational gate, but GitHub still technically permits an administrator to bypass it. The target repository configuration is:

- Require a pull request before merging to `main`.
- Require status check: `owner-production-approval`.
- Require CODEOWNERS/owner review where the plan supports it.
- Do not allow force pushes or branch deletion for `main`.
- Keep direct Production deployment tied to `main` only.

## Non-goals

This policy does not alter Vercel environment variables, Supabase settings, customer data, billing, or runtime application behavior.
