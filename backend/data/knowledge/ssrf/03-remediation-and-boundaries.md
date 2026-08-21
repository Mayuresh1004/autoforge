---
id: kb:SSRF-03
externalId: CWE-918
vulnerabilityType: SSRF
cwe: CWE-918
severity: HIGH
sourceType: amass-kb
language: generic
framework: generic
sourceUrl: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
---

# Server-Side Request Forgery (SSRF): Remediation Strategy and Security Boundaries

## 4. Remediation Principles

### Preferred Remediation (Gold Standard)
1. **Strict URL Scheme Validation**: Enforce that the URL scheme is strictly `http` or `https`. Reject `file:`, `gopher:`, `ftp:`, `data:`, `dict:`.
2. **DNS Resolution + IP Subnet Filtering**:
   - Parse the URL and extract the hostname.
   - Resolve the hostname to IP address(es) via DNS lookup.
   - Validate that resolved IPs do NOT match private, loopback, or cloud-metadata ranges:
     - `127.0.0.0/8` (Loopback)
     - `10.0.0.0/8` (Private Class A)
     - `172.16.0.0/12` (Private Class B)
     - `192.168.0.0/16` (Private Class C)
     - `169.254.0.0/16` (Link-Local / Cloud Metadata)
     - `::1`, `fe80::/10`, `fc00::/7` (IPv6 Loopback / Local)
3. **Disable Automatic Redirect Following**: Configure the HTTP client to disable automatic redirects, or validate the target IP of each redirect step.
4. **Domain Allowlisting**: Where possible, restrict target destinations to a predefined allowlist of domain names or APIs.

### Acceptable Alternative Remediation
- Use a dedicated HTTP proxy / egress gateway configured to block internal subnets at the network layer.

### Critical Edge Cases
- **DNS Rebinding**: Attacker configures a domain (e.g. `rebind.evil.com`) to resolve to a public IP on first lookup (passing pre-request checks) and `127.0.0.1` on second lookup. Remediation MUST connect directly to the validated resolved IP address or use custom agent socket binding.
- **Decimal / Hex / IPv6 Encodings**: `http://2130706433` (decimal for `127.0.0.1`), `http://0x7f000001` (hex), `http://[::1]`. Always perform IP validation AFTER canonicalizing and resolving via `dns.lookup()` / `socket.getaddrinfo()`.

---

## Security Boundaries That Must Remain Intact

When Engineer generates a patch for SSRF remediation:
1. **Public Outbound Integration**: Valid external HTTP requests must continue working without breaking third-party API contracts.
2. **Timeout and Error Handling**: Network timeout settings and structured error responses (e.g., HTTP 400 with `Invalid URL destination`) must be preserved.
