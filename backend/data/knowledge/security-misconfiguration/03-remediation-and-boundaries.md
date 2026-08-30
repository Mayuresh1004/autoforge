---
id: kb:SECURITY_MISCONFIGURATION-03
externalId: CWE-16
vulnerabilityType: SECURITY_MISCONFIGURATION
cwe: CWE-16
severity: HIGH
sourceType: amass-kb
language: generic
framework: generic
sourceUrl: https://cheatsheetseries.owasp.org/cheatsheets/Configuration_and_Vulnerability_Management_Cheat_Sheet.html
---

# Security Misconfiguration: Remediation Strategy and Security Boundaries

## Remediation Principles

### Debug & Configuration Disclosure Endpoints
1. **Disable Debug Endpoints**: Sensitive debug or configuration endpoints (e.g. `/api/debug/config`, `/debug`, `/env`, `/actuator`) must be disabled or return HTTP 404 Not Found or HTTP 403 Forbidden in production environments.
2. **Remove Sensitive Environment Data**: Never return internal secret keys (`jwtSecret`, `dbPassword`, `appSecret`), configuration files, or database credentials/paths in API responses.
3. **Response Status**: To properly fix an exposed debug endpoint, return a 404 Not Found or 403 Forbidden HTTP status code and do NOT disclose any sensitive configuration parameters or environment variables in the response body.
