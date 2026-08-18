# OWASP ZAP Baseline Scan Triage Guide

This guide explains how automated DAST (Dynamic Application Security Testing) is executed in the CI pipeline, and how to triage and whitelist false positives.

## Architecture & Ephemeral Staging Deployment

1. **Ephemeral Staging Stack**: The CI pipeline automatically spins up a real, ephemeral staging environment in the runner (`docker compose up -d --build` running PostgreSQL, the backend API on `:4000`, and the Next.js frontend on `:3000`).
2. **Active Baseline Scanning**: The `zaproxy/action-baseline` GitHub Action runs against the ephemeral frontend target (`http://localhost:3000`), exercising dynamic security rules against real rendered routes and connected API endpoints.
3. **Report Generation**: The scan generates standard HTML and JSON findings reports (`report_html.html` and `report.json`).
4. **CI Rules Enforcement**: The CI executes a triage script (`scripts/triage-zap.js`) which parses `report.json`.
5. **Enforced Threshold**: The build **fails automatically** if there are any unhandled **HIGH or CRITICAL** risk findings (risk code `3`). Findings are not silently ignored.
6. **Teardown**: The ephemeral staging stack is torn down (`docker compose down -v`) after scanning completes.

---

## Scan Cadence & Target Decision

### Target Architecture: Ephemeral Local Staging vs. Hosted Staging
- **Selected Target**: Ephemeral local deployment (`http://localhost:3000`) spun up on demand inside the CI runner.
- **Rationale & Trade-offs**:
  - **Reliability**: Eliminates external DNS resolution, TLS, and public network flakiness.
  - **Isolation**: Each PR and commit scans the exact code under test without risk of state pollution or concurrent test runs colliding on a shared server.
  - **Cost**: Incurs zero continuous cloud hosting costs ($0 idle infrastructure).
  - **Speed**: Local loopback networking provides fast response times for crawler spidering and passive analysis.

### Scan Cadence
- **PR & Main Branch CI**: OWASP ZAP Baseline Scan runs on every pull request to `main` and pushes to `main`/`develop`. It quickly identifies missing security headers, injection surfaces, and configuration regressions without blocking fast iteration.
- **Deep / Full Active Scans**: Scheduled weekly or pre-release against dedicated staging environments for exhaustive attack simulation (SQLi/XSS active fuzzing) that exceeds standard CI timeout budgets.

---

## How to Triage and Add False Positives

If a HIGH finding is reported by ZAP in CI but is determined to be a **false positive** or an intentional architectural design:

1. Identify the details of the finding in the CI console logs (or download the `report.json` artifact). Specifically note:
   - **Plugin ID**: The ZAP scanner ID (e.g. `10020`).
   - **Alert**: The name of the alert.
   - **URI/URL**: The page/endpoint that triggered the alert.

2. Open the main config file [zap-false-positives.json](../zap-false-positives.json).

3. Append your rule override inside `ignored_alerts`:
   ```json
   {
     "pluginId": "10020",
     "alert": "X-Frame-Options Header Scanner",
     "url": "/widget",
     "reason": "Intentionally allowed frame embedding on widget sub-routes to support integration on third-party sites."
   }
   ```
   *Note: If `url` is omitted, the override will apply to all instances matching that Plugin ID globally. Provide a `url` substring (e.g., `/widget`) if the exclusion should be scoped strictly.*

4. Commit and push the changes. The next CI run will verify the triage list, skip the matching alert, and allow the pipeline to succeed.

