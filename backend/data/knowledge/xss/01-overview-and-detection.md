---
id: kb:XSS-01
externalId: CWE-79
vulnerabilityType: XSS
cwe: CWE-79
severity: MEDIUM
sourceType: amass-kb
language: generic
framework: generic
sourceUrl: https://owasp.org/www-community/attacks/xss/
---

# Cross-Site Scripting (XSS): Overview and Detection Indicators

## 1. Vulnerability Definition

### What the Vulnerability Is
Cross-Site Scripting (XSS - CWE-79) occurs when an application includes untrusted, user-supplied data in an HTTP response (or DOM manipulation) without proper contextual output encoding, escaping, or sanitization, allowing an attacker to execute malicious client-side scripts in the victim's browser context.

### XSS Variants
1. **Reflected XSS**: The payload is included in an immediate HTTP request (e.g. GET parameter, URL path) and echoed directly back in the server's HTML response.
2. **Stored XSS**: The payload is stored permanently in a database, log file, or cache, and later rendered unescaped to other users viewing the resource.
3. **DOM-Based XSS**: Client-side JavaScript reads user input from a DOM source (e.g. `location.search`, `location.hash`) and writes it unescaped to a dangerous DOM sink (e.g. `element.innerHTML`, `document.write`).

### Typical Root Causes
- Constructing raw HTML strings using string concatenation or template literals (`res.send('<h1>Hello ' + name + '</h1>')`).
- Disabling template auto-escaping (e.g., Jinja2 `| safe` filter in Python Flask, or `{{{ unescaped }}}` in Handlebars).
- Using raw HTML rendering properties in modern SPA frameworks (e.g., `dangerouslySetInnerHTML` in React, `v-html` in Vue).
- Returning HTML content (`Content-Type: text/html`) for API endpoints that handle text inputs.

### Security Impact
- **Session Hijacking**: Stealing sensitive session cookies (`document.cookie`) if not protected with `HttpOnly`.
- **Credential Theft & Defacement**: Displaying fake login forms to capture credentials or altering site appearance.
- **Unauthorized Actions (CSRF via XSS)**: Performing actions on behalf of the logged-in user within the web application.

---

## 2. Detection Indicators

### Source-Code Patterns
- **Node.js / Express**:
  - `res.send('... ' + req.query.input)`
  - `res.write('<div>' + userInput + '</div>')`
  - EJS unescaped tags: `<%- userInput %>`
  - Handlebars unescaped tags: `{{{ userInput }}}`
  - React: `<div dangerouslySetInnerHTML={{ __html: userInput }} />`
- **Python (Flask / FastAPI)**:
  - Flask: `render_template_string("<h1>" + request.args.get("name") + "</h1>")`
  - Jinja2: `{{ user_input | safe }}`
  - FastAPI: `Response(content=f"<html>{user_input}</html>", media_type="text/html")`

### Dangerous APIs & Sinks
- `res.send()`, `res.write()` (when serving HTML without escaping)
- `render_template_string()`
- `dangerouslySetInnerHTML`
- `element.innerHTML`, `document.write()`, `eval()`

### Relevant Routes and Controllers
- `/search?q=...`
- `/profile/view?user=...`
- `/comments/submit`
- `/feedback/preview`
