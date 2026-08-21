---
id: kb:XSS-03
externalId: CWE-79
vulnerabilityType: XSS
cwe: CWE-79
severity: MEDIUM
sourceType: amass-kb
language: generic
framework: generic
sourceUrl: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
---

# Cross-Site Scripting (XSS): Remediation Strategy and Security Boundaries

## 4. Remediation Principles

### Preferred Remediation (Gold Standard)
1. **Contextual HTML Entity Escaping**: Convert all user-supplied data to safe HTML entities before embedding into HTML body context:
   - `<` $\rightarrow$ `&lt;`
   - `>` $\rightarrow$ `&gt;`
   - `&` $\rightarrow$ `&amp;`
   - `"` $\rightarrow$ `&quot;`
   - `'` $\rightarrow$ `&#x27;`
2. **Use Native Framework Templates**: Utilize standard template engines (EJS `<%= %>`, Jinja2 `{{ }}` without `| safe`, React JSX `{}`) which automatically apply HTML escaping by default.
3. **Set Content-Type Headers Explicitly**: Ensure REST API endpoints set `Content-Type: application/json; charset=utf-8` so browsers treat payloads as pure data rather than executable HTML.
4. **Content Security Policy (CSP)**: Deploy strict HTTP response headers:
   `Content-Security-Policy: default-src 'self'; script-src 'self'`
5. **HTML Sanitization for Rich Text**: If the application MUST accept rich HTML formatting, sanitize inputs using a robust HTML sanitizer (`sanitize-html` in Node.js, `bleach` or `nh3` in Python) configured with a strict whitelist of allowed tags and attributes.

### Critical Edge Cases
- **Attribute Context**: Embedding user input inside HTML attributes (`<input value="USER_INPUT">`). Escaping must include quotes (`&quot;`, `&#x27;`) and space characters.
- **JavaScript Context**: Embedding user input inside inline `<script>` tags (`var name = "USER_INPUT";`). HTML entity encoding is INSUFFICIENT; JavaScript variable encoding (`JSON.stringify()`) must be used.
- **URL Context**: User input in `href` attributes (`<a href="USER_INPUT">`). Must check URL scheme (`http:`, `https:`, `mailto:`) to prevent `javascript:` pseudoprotocol execution.

---

## Security Boundaries That Must Remain Intact

When Engineer generates a patch for XSS remediation:
1. **JSON API Integrity**: API endpoints must continue returning valid JSON structures without double-escaping valid characters inside JSON string values.
2. **UI Formatting**: Valid text strings containing symbols (e.g. `1 < 2 & 3 > 0`) must display correctly to the user.
