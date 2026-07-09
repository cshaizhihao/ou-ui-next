# Round 14 - Release Candidate Hardening

## Goal

Close the V2.0.0 construction sequence with executable validation, local deployment, browser smoke, git commit, and push.

## Validation Checklist

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run deploy:local-4174`
- Browser smoke against `http://127.0.0.1:4174/`
- Playwright / Chrome cleanup after browser validation
- Git diff check and commit
- Push to `origin/main`

## Acceptance Criteria

- 4174 root, login, dashboard, and navigation remain usable.
- README and roadmap docs match the implemented runtime boundary.
- No Playwright or project Chrome process is left running after validation.
- The final report includes commit hash, push status, deployment status, verification status, and remaining roadmap.

## Remaining Product Roadmap After V2.0.0 Hardening

- First-class Inbound / Client CRUD APIs.
- Full Xray multi-client cockpit workflows.
- Complete customer portal and token delivery / revocation lifecycle.
- Forwarding advanced controls once Agent runtime implements them.
- Stronger Control Plane schema and higher-concurrency storage model.
- Full release packaging and release notes for the next tagged version.
