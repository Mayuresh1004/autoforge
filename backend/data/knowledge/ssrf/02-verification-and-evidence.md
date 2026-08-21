---
id: kb:SSRF-02
externalId: CWE-918
vulnerabilityType: SSRF
cwe: CWE-918
severity: HIGH
sourceType: amass-kb
language: generic
framework: generic
sourceUrl: https://owasp.org/www-community/attacks/Server_Side_Request_Forgery
---

# Server-Side Request Forgery (SSRF): Verification Evidence and Exploitation Thresholds

## 3. Verification Evidence Requirements

To ensure zero false positives, AMASS distinguishes between **suspicious code**, a **potential vulnerability**, and **confirmed exploitability**.

### Level 1: Suspicious Code (Scanner Signal)
- Scanner flags `requests.get(url)` or `axios.get(req.body.url)`.
- **Verdict**: Inconclusive. Requires inspection of input sanitization and URL origin.

### Level 2: Potential Vulnerability (Planner Hypothesis)
- Target route accepts a URL parameter from user input and makes a server-side request without explicit IP/subnet validation.
- **Verdict**: Vulnerability candidate. Requires active exploit verification by Sniper.

### Level 3: Confirmed Exploitability (Sniper Verification Standard)
To confirm an SSRF vulnerability, verification proof must meet **at least one** of the following empirical criteria:

1. **Internal Service Access Confirmation**:
   - Supplying an internal target URL (e.g. `http://127.0.0.1:8000/health`, `http://localhost:6379`, `http://169.254.169.254/latest/meta-data/`) causes the server to issue the request and return internal response content, headers, or unique diagnostic signatures in the HTTP response body.

2. **Out-of-Band (OOB) Interaction**:
   - Supplying a unique test-controlled URL causes the target application server to initiate an inbound HTTP/DNS request to the listener.

3. **Protocol Downgrade / Arbitrary File Access**:
   - Supplying non-HTTP schemes (e.g. `file:///etc/passwd`) causes the server to read and return local file contents in the HTTP response.

---

## Exploitation Proof Structure

```json
{
  "indicator": "ssrf:internal_endpoint_accessed",
  "category": "exploit_proof",
  "httpStatus": 200,
  "detail": "Target fetched http://127.0.0.1:8000/health and returned internal payload: '{\"status\":\"UP\"}'",
  "confidenceFactor": 0.95
}
```
