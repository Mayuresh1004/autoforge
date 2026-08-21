---
id: kb:XSS-04
externalId: CWE-79
vulnerabilityType: XSS
cwe: CWE-79
severity: MEDIUM
sourceType: amass-kb
language: javascript,python
framework: express,react,flask,fastapi
sourceUrl: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
---

# Cross-Site Scripting (XSS): Patch Patterns and Framework Guidance

## 5. Localized Patch Patterns

### Pattern A: Node.js / Express (HTML Output Escaping)

#### Vulnerable Code (Before)
```javascript
const express = require('express');
const app = express();

app.get('/search', (req, res) => {
  const query = req.query.q || '';
  // UNSAFE: Unescaped concatenation into HTML response
  res.send(`<html><body><h1>Search Results for: ${query}</h1></body></html>`);
});
```

#### Secure Remediation Patch (After)
```javascript
const express = require('express');
const app = express();

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

app.get('/search', (req, res) => {
  const query = req.query.q || '';
  // SECURE: HTML entity escaping user input
  const safeQuery = escapeHtml(query);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<html><body><h1>Search Results for: ${safeQuery}</h1></body></html>`);
});
```

---

### Pattern B: Python / Flask (Template String Replacement)

#### Vulnerable Code (Before)
```python
from flask import Flask, request, render_template_string

app = Flask(__name__)

@app.route('/welcome')
def welcome():
    name = request.args.get('name', 'Guest')
    # UNSAFE: render_template_string with raw string formatting disables Jinja2 escaping
    return render_template_string(f"<h1>Welcome, {name}!</h1>")
```

#### Secure Remediation Patch (After)
```python
from flask import Flask, request, render_template_string
from markupsafe import escape

app = Flask(__name__)

@app.route('/welcome')
def welcome():
    name = request.args.get('name', 'Guest')
    # SECURE: Explicitly escape user input or use render_template with parameters
    safe_name = escape(name)
    return render_template_string("<h1>Welcome, {{ name }}!</h1>", name=safe_name)
```

---

### Pattern C: React (DangerouslySetInnerHTML Sanitization)

#### Vulnerable Code (Before)
```jsx
function UserComment({ commentHtml }) {
  // UNSAFE: Direct unescaped HTML injection
  return <div dangerouslySetInnerHTML={{ __html: commentHtml }} />;
}
```

#### Secure Remediation Patch (After)
```jsx
import DOMPurify from 'dompurify';

function UserComment({ commentHtml }) {
  // SECURE: Sanitize rich HTML prior to rendering, or render as plain text node
  const cleanHtml = DOMPurify.sanitize(commentHtml);
  return <div dangerouslySetInnerHTML={{ __html: cleanHtml }} />;
}
```
