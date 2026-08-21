---
id: kb:SSRF-01
externalId: CWE-918
vulnerabilityType: SSRF
cwe: CWE-918
severity: HIGH
sourceType: amass-kb
language: generic
framework: generic
sourceUrl: https://owasp.org/www-community/attacks/Server_Side_Request_Forgery
---

# Server-Side Request Forgery (SSRF): Overview and Detection Indicators

## 1. Vulnerability Definition

### What the Vulnerability Is
Server-Side Request Forgery (SSRF - CWE-918) occurs when a web application accepts a user-controlled URL or network destination and uses it to initiate a server-side HTTP or TCP request without properly validating or restricting the target IP address, domain, or URI scheme.

### Typical Root Causes
1. **Unchecked Remote Fetching**: Fetching URLs provided in user input (e.g. webhook URLs, avatar image URLs, PDF generation targets, RSS feeds, import endpoints) directly using server-side HTTP clients.
2. **Missing Private IP Filtering**: Failing to block requests targeting loopback addresses (`127.0.0.1`, `::1`, `localhost`), private RFC 1918 subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), or link-local metadata endpoints (`169.254.169.254`).
3. **DNS Rebinding & Redirection Vulnerabilities**: Validating domain names before DNS resolution without re-verifying the resolved IP address, or automatically following HTTP redirects to internal destinations.
4. **Dangerous Protocol Schemes**: Permitting non-HTTP URL schemes such as `file://`, `gopher://`, `dict://`, `ftp://`, or `sftp://`.

### Security Impact
- **Cloud Metadata Compromise**: Accessing cloud instance metadata (AWS EC2 metadata service `http://169.254.169.254/latest/meta-data/`, GCP metadata, Azure IMDS) to steal IAM credentials or API tokens.
- **Internal Network Reconnaissance & Exploitation**: Scanning and interacting with unauthenticated internal microservices, Redis databases (`http://127.0.0.1:6379`), Memcached, or internal admin interfaces.
- **Bypassing Network Access Controls**: Bypassing firewalls and network segmentation because requests originate from the trusted server IP.

---

## 2. Detection Indicators

### Source-Code Patterns
Look for server-side HTTP request invocations using input parameters:
- **Node.js / Express**: `axios.get(req.body.url)`, `fetch(req.query.target)`, `got(req.body.webhook)`, `request(url)`, `http.get(url)`.
- **Python (FastAPI / Flask)**: `requests.get(url)`, `httpx.get(url)`, `urllib.request.urlopen(url)`, `aiohttp.ClientSession().get(url)`.

### Dangerous APIs & Functions
- `axios.get()`, `axios.post()`
- `fetch()`
- `requests.get()`, `requests.post()`
- `urllib.request.urlopen()`
- `pycurl.Curl()`

### Relevant Routes and Controllers
- `/api/webhooks/subscribe`
- `/api/avatar/fetch-remote`
- `/api/export/pdf?url=...`
- `/api/link-preview`
- `/api/import/rss`

### Configuration Indicators
- HTTP clients configured with `followRedirects: true` or `maxRedirects > 0` without custom redirect hooks.
- Lack of egress filtering or proxy configuration on the server host.
