---
id: kb:IDOR-05
externalId: CWE-639
vulnerabilityType: BROKEN_ACCESS_CONTROL
cwe: CWE-639
severity: HIGH
sourceType: amass-kb
language: generic
framework: generic
sourceUrl: https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_References_Prevention_Cheat_Sheet.html
---

# IDOR and Broken Access Control: Critic Validation and False-Positive Guidance

## 6. Critic Validation Requirements

When validating a patch for IDOR / Broken Access Control, Critic must run the following validation matrix:

### 1. Authorized Access Test (Owner Access)
- Authenticated owner accessing their own record (`user_A` requesting `doc_user_A`) must return HTTP 200 with complete data.

### 2. Security Regression Test (Unauthorized Access Blocked)
- Authenticated non-owner (`user_B` requesting `doc_user_A`) must receive HTTP 404 or HTTP 403.
- Unauthenticated requests to protected endpoints must return HTTP 401 Unauthorized.

### 3. Functional Regression Test
- Database model relations and returned field types must match API specifications.

### 4. Exploit Retest Expectations
- Retesting cross-user requests using original Sniper credentials must produce `NOT_CONFIRMED` or `NOT_TESTED` without data disclosure.

---

## 8. False-Positive Guidance

Static scanners routinely flag any database query accepting an ID parameter as potential IDOR. AMASS must **NOT** assume vulnerability in the following non-exploitable contexts:

### Non-Exploitable Scenarios (False Positives)

1. **Intentionally Public Resources**:
   - Endpoints designed for public data access (e.g., `/api/posts/:slug`, `/api/products/:id`, `/api/public-profiles/:username`).
   - Data does not contain private user information or require authorization limits.

2. **Middleware-Enforced Authorization**:
   - Access control is enforced upstream by reusable authorization middleware (e.g. `app.use('/api/documents/:id', checkDocumentAccess)` or custom policy guard decorators).

3. **Global System Read-Only Config Data**:
   - Queries referencing global lookup tables (e.g., state lists, currency codes, public taxonomy categories).

### Critic Verification Check
If baseline code queries public catalog data or uses upstream authorization middleware, Critic MUST reject patches that add unnecessary user-id constraints or break public API access.
