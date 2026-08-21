---
id: kb:SSRF-05
externalId: CWE-918
vulnerabilityType: SSRF
cwe: CWE-918
severity: HIGH
sourceType: amass-kb
language: generic
framework: generic
sourceUrl: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
---

# Server-Side Request Forgery (SSRF): Critic Validation and False-Positive Guidance

## 6. Critic Validation Requirements

When evaluating an Engineer patch for an SSRF vulnerability, Critic must verify four test conditions:

### 1. Baseline Behavior Test
- Requests to valid public HTTP/HTTPS URLs (e.g. `https://httpbin.org/get` or `https://api.github.com/zen`) must succeed and return expected status codes.

### 2. Security Regression Test (Forbidden Targets Blocked)
- Requests to loopback addresses (`http://127.0.0.1`, `http://localhost:8000`, `http://[::1]`) must return HTTP 400 with a validation error.
- Requests to cloud metadata (`http://169.254.169.254/latest/meta-data/`) must be blocked with HTTP 400.
- Non-HTTP schemes (`file:///etc/passwd`, `gopher://127.0.0.1:6379`) must be rejected with HTTP 400.

### 3. Functional Regression Test
- The route signature, return JSON schema, and HTTP error format must comply with contract requirements.

### 4. Exploit Retest Expectations
- Re-running the original Sniper SSRF proof payload against the patched application must result in `NOT_CONFIRMED` or `NOT_TESTED` with zero internal data leakage.

---

## 8. False-Positive Guidance

Static analysis tools frequently flag any outbound HTTP request call as potential SSRF. AMASS must **NOT** label an endpoint as vulnerable if any of the following controls exist:

### Non-Exploitable Scenarios (False Positives)

1. **Hardcoded Base Domain / Static URL Prefixes**:
   - Code constructs the target URL using a hardcoded domain prefix and only appends a sanitized sub-path:
     `const targetUrl = `https://api.trustedvendor.com/v1/items/${encodeURIComponent(req.params.id)}`;`
   - The user cannot control the target host or scheme.

2. **Internal API Microservice Gateway Routing**:
   - The application makes internal microservice calls where the target host is controlled by server-side environment configuration (e.g., `process.env.PAYMENT_SERVICE_URL`), not user input.

3. **Egress Proxy Isolation**:
   - Outbound HTTP clients are configured to route through a proxy that enforces strict network ACLs blocking internal subnets at the infrastructure layer.

### Critic Verification Check
If baseline code uses hardcoded domain prefixes or static host bindings, Critic MUST reject patches that introduce redundant DNS lookup wrappers or break static host routing.
