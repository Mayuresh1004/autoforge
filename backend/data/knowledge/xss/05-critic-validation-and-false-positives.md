---
id: kb:XSS-05
externalId: CWE-79
vulnerabilityType: XSS
cwe: CWE-79
severity: MEDIUM
sourceType: amass-kb
language: generic
framework: generic
sourceUrl: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
---

# Cross-Site Scripting (XSS): Critic Validation and False-Positive Guidance

## 6. Critic Validation Requirements

When validating a patch for XSS, Critic must enforce the following validation suite:

### 1. Baseline Behavior Test
- Normal text queries and alphanumeric inputs (e.g. `john_doe`, `hello world`) return HTTP 200 and display properly.

### 2. Security Regression Test (HTML Payload Escaping)
- Sending `<script>alert(1)</script>` or `<img src=x onerror=alert(1)>` must result in HTML entity encoded output (`&lt;script&gt;alert(1)&lt;/script&gt;`) in the response body.
- Unescaped script tags must NEVER appear in `text/html` responses.

### 3. Functional Regression Test
- REST API endpoints returning JSON payloads must retain `Content-Type: application/json` without breaking JSON client parsers.

### 4. Exploit Retest Expectations
- Sniper verification retry against the patched endpoint must return `NOT_CONFIRMED` or `NOT_TESTED`.

---

## 8. False-Positive Guidance

Static scanners frequently flag any variable output in template files or API responses. AMASS must **NOT** categorize an endpoint as vulnerable in the following non-exploitable contexts:

### Non-Exploitable Scenarios (False Positives)

1. **JSON API Responses**:
   - The endpoint returns data formatted as `application/json` (e.g. `res.json({ search: req.query.q })`).
   - Browsers parser rules do not execute HTML/JS inside `application/json` responses.

2. **React / Vue Auto-Escaping**:
   - Output rendered using standard JSX bindings `{userInput}` or Vue `{{ userInput }}`. React and Vue automatically perform contextual HTML entity encoding on all interpolation bindings.

3. **Plain Text Responses**:
   - Endpoint returns `Content-Type: text/plain`. Browsers treat text/plain responses as unparsed text, rendering `<script>` literally without execution.

### Critic Verification Check
If baseline code returns `application/json` or uses standard JSX string bindings, Critic MUST reject unnecessary escaping patches that corrupt valid JSON strings or double-escape frontend text node bindings.
