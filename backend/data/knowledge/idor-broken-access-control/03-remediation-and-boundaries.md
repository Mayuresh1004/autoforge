---
id: kb:IDOR-03
externalId: CWE-639
vulnerabilityType: BROKEN_ACCESS_CONTROL
cwe: CWE-639
severity: HIGH
sourceType: amass-kb
language: generic
framework: generic
sourceUrl: https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_References_Prevention_Cheat_Sheet.html
---

# IDOR and Broken Access Control: Remediation Strategy and Security Boundaries

## 4. Remediation Principles

### Preferred Remediation (Gold Standard)
1. **Context-Aware Database Scoping**: Enforce ownership checks directly in the database query clause:
   - Prisma: `where: { id: req.params.id, userId: req.user.id }`
   - SQLAlchemy: `.filter(Document.id == doc_id, Document.owner_id == current_user.id)`
   - Knex: `.where({ id: req.params.id, user_id: req.user.id })`
2. **Return 404 or 403 for Unauthorized Attempts**: If a record exists but does not belong to the requesting user, return `HTTP 404 Not Found` (to prevent ID enumeration) or `HTTP 403 Forbidden`.
3. **Explicit Authorization Middleware**: Apply an authorization policy check prior to executing data layer operations:
   `if (!canUserAccessDocument(req.user, document)) return res.status(403).json({ error: 'Access denied' });`
4. **Role-Based Access Control Guards**: For administrative routes, verify user roles before granting access (`if (req.user.role !== 'ADMIN') return res.status(403)...`).

### Acceptable Alternative Remediation
- **Indirect Reference Maps**: Use temporary session-bound randomized keys (e.g. `doc_ref_1`, `doc_ref_2`) mapped to actual database IDs in the server session, preventing direct database primary key manipulation.

### Critical Edge Cases
- **Multi-Tenant System Isolation**: In multi-tenant applications, always include `tenantId` in every query filter (`where: { id, tenantId: req.user.tenantId }`).
- **Composite ID Validation**: When performing nested resource operations (e.g. `/api/teams/:teamId/members/:memberId`), verify that `memberId` belongs to `teamId` AND that the authenticated user has access to `teamId`.

---

## Security Boundaries That Must Remain Intact

When Engineer generates a patch for IDOR remediation:
1. **Authorized Access Working**: Legitimate users must retain full access to their own resources without permission errors.
2. **API Data Schemas**: Return payload shapes and HTTP 200 structures for authorized requests must remain unaltered.
