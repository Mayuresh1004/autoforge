---
id: kb:XSS-02
externalId: CWE-79
vulnerabilityType: XSS
cwe: CWE-79
severity: MEDIUM
sourceType: amass-kb
language: generic
framework: generic
sourceUrl: https://owasp.org/www-community/attacks/xss/
---

# Cross-Site Scripting (XSS): Verification Evidence and Exploitation Thresholds

## 3. Verification Evidence Requirements

AMASS enforces a strict distinction between **suspicious code**, a **potential vulnerability**, and **confirmed exploitability**.

### Level 1: Suspicious Code (Scanner Signal)
- Scanner flags concatenation inside `res.send()` or `render_template_string()`.
- Source code uses `dangerouslySetInnerHTML` or `| safe`.
- **Verdict**: Inconclusive. Requires inspection of header types and sanitization filters.

### Level 2: Potential Vulnerability (Planner Hypothesis)
- Target endpoint accepts string parameters and includes them in an HTTP response rendered with `Content-Type: text/html`.
- **Verdict**: Vulnerability candidate. Requires active verification by Sniper.

### Level 3: Confirmed Exploitability (Sniper Verification Standard)
To confirm an XSS vulnerability, the verification proof must satisfy **all three** of the following conditions:

1. **Payload Reflection / Persistence**:
   - An HTTP request containing an HTML/JS payload (e.g. `<script>alert('AMASS_XSS')</script>` or `<img src=x onerror=alert('AMASS_XSS')>`) is sent to the target endpoint.
2. **Unescaped Output Execution Context**:
   - The HTTP response body contains the payload characters (`<`, `>`, `"`, `'`) **completely unescaped** without HTML entity encoding (`&lt;`, `&gt;`).
3. **HTML Document Response Type**:
   - The HTTP response header `Content-Type` is `text/html` or `application/xhtml+xml` (allowing browser script execution). If the response header is `application/json` or `text/plain`, the payload cannot execute as XSS in standard browsers.

---

## Exploitation Proof Structure

```json
{
  "indicator": "xss:reflected_script_injection",
  "category": "exploit_proof",
  "httpStatus": 200,
  "detail": "GET /search?q=<script>alert('AMASS_XSS')</script> returned Content-Type: text/html with unescaped payload '<script>alert('AMASS_XSS')</script>' in body",
  "confidenceFactor": 0.95
}
```
