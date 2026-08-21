---
id: kb:IDOR-02
externalId: CWE-639
vulnerabilityType: BROKEN_ACCESS_CONTROL
cwe: CWE-639
severity: HIGH
sourceType: amass-kb
language: generic
framework: generic
sourceUrl: https://owasp.org/www-project-top-ten/2021/A01_2021-Broken_Access_Control/
---

# IDOR and Broken Access Control: Verification Evidence and Exploitation Thresholds

## 3. Verification Evidence Requirements

To ensure accurate verification, AMASS strictly separates **suspicious code**, a **potential vulnerability**, and **confirmed exploitability**.

### Level 1: Suspicious Code (Scanner Signal)
- Scanner flags a route containing a path parameter `:id` or `GET /api/resource/:id`.
- Code queries database by `id` parameter.
- **Verdict**: Inconclusive. Code inspection required to determine if authorization guards or row-level tenant filtering exist.

### Level 2: Potential Vulnerability (Planner Hypothesis)
- Target route performs database reads or writes using an object ID parameter without matching against `req.user.id` or verifying authorization policies.
- **Verdict**: Vulnerability candidate. Requires active multi-session exploit verification by Sniper.

### Level 3: Confirmed Exploitability (Sniper Verification Standard)
To confirm an IDOR / Broken Access Control vulnerability, verification proof must satisfy **all three** of the following criteria:

1. **Multi-Tenant Context Authentication**:
   - The test setup provisions two distinct authenticated user sessions: User A (owner of Object A) and User B (attacker).
2. **Cross-Boundary Resource Request**:
   - User B submits an HTTP request targeting Object A (`GET /api/documents/doc_user_A` or `DELETE /api/documents/doc_user_A`) carrying User B's valid authentication token/cookie.
3. **Unauthorized Data Leakage or State Mutation**:
   - The application returns HTTP 200/204, disclosing User A's private data to User B or modifying Object A's state in the database.
   - If the application correctly rejects the request with HTTP 403 Forbidden or HTTP 404 Not Found, the access control is intact and the target is **NOT_CONFIRMED**.

---

## Exploitation Proof Structure

```json
{
  "indicator": "idor:cross_user_access_confirmed",
  "category": "exploit_proof",
  "httpStatus": 200,
  "detail": "User B (id: user_222) successfully retrieved private document belonging to User A (id: user_111, doc_id: doc_999)",
  "confidenceFactor": 0.95
}
```
