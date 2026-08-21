---
id: kb:SSRF-04
externalId: CWE-918
vulnerabilityType: SSRF
cwe: CWE-918
severity: HIGH
sourceType: amass-kb
language: javascript,python
framework: express,fastapi,flask
sourceUrl: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
---

# Server-Side Request Forgery (SSRF): Patch Patterns and Framework Guidance

## 5. Localized Patch Patterns

### Pattern A: Node.js / Express (Axios / Native DNS Validation)

#### Vulnerable Code (Before)
```javascript
const express = require('express');
const axios = require('axios');
const app = express();

app.post('/api/webhook/test', async (req, res) => {
  const { url } = req.body;
  // UNSAFE: Directly fetching user-controlled URL
  const response = await axios.get(url);
  res.json({ status: response.status, data: response.data });
});
```

#### Secure Remediation Patch (After)
```javascript
const express = require('express');
const axios = require('axios');
const dns = require('dns/promises');
const net = require('net');
const app = express();

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 127 || parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true; // Metadata IP
    if (parts[0] === 0) return true;
  }
  if (net.isIPv6(ip)) {
    if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc00:')) return true;
  }
  return false;
}

async function validateUrl(targetUrl) {
  const parsed = new URL(targetUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS schemes are allowed');
  }

  const lookup = await dns.lookup(parsed.hostname);
  if (isPrivateIp(lookup.address)) {
    throw new Error('Requests to private or internal IP addresses are blocked');
  }
  return targetUrl;
}

app.post('/api/webhook/test', async (req, res) => {
  try {
    const safeUrl = await validateUrl(req.body.url);
    const response = await axios.get(safeUrl, { maxRedirects: 0, timeout: 5000 });
    res.json({ status: response.status, data: response.data });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
```

---

### Pattern B: Python / FastAPI (Requests / IP Validation)

#### Vulnerable Code (Before)
```python
from fastapi import FastAPI, HTTPException
import requests

app = FastAPI()

@app.post("/fetch")
def fetch_url(url: str):
    # UNSAFE: Direct requests.get without IP validation
    resp = requests.get(url)
    return {"content": resp.text}
```

#### Secure Remediation Patch (After)
```python
import socket
import ipaddress
from urllib.parse import urlparse
from fastapi import FastAPI, HTTPException
import requests

app = FastAPI()

def is_private_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return True
    hostname = parsed.hostname
    if not hostname:
        return True
    try:
        # Resolve hostname to IP address
        addr_info = socket.getaddrinfo(hostname, None)
        for family, _, _, _, sockaddr in addr_info:
            ip_str = sockaddr[0]
            ip = ipaddress.ip_address(ip_str)
            if ip.is_private or ip.is_loopback or ip.is_link_local:
                return True
    except socket.gaierror:
        return True
    return False

@app.post("/fetch")
def fetch_url(url: str):
    if is_private_url(url):
        raise HTTPException(status_code=400, detail="Forbidden target URL or IP address")

    try:
        resp = requests.get(url, allow_redirects=False, timeout=5.0)
        return {"content": resp.text}
    except requests.RequestException as e:
        raise HTTPException(status_code=400, detail="Failed to fetch target URL")
```
