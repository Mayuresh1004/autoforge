---
id: kb:IDOR-01
externalId: CWE-639
vulnerabilityType: BROKEN_ACCESS_CONTROL
cwe: CWE-639
severity: HIGH
sourceType: amass-kb
language: generic
framework: generic
sourceUrl: https://owasp.org/www-project-top-ten/2021/A01_2021-Broken_Access_Control/
---

# IDOR and Broken Access Control: Overview and Detection Indicators

## 1. Vulnerability Definition

### What the Vulnerability Is
Insecure Direct Object Reference (IDOR - CWE-639) and Broken Access Control (CWE-284) occur when an application uses user-supplied input (such as a database ID, UUID, filename, or record key) to access or mutate a resource without verifying that the currently authenticated user possesses authorization rights for that specific object.

### Typical Root Causes
1. **Missing Ownership Check in Database Queries**: Fetching or updating records using only the object ID (`where: { id }`) rather than scoping the query to the authenticated user's ID (`where: { id, ownerId: currentUser.id }`).
2. **Implicit Authorization Assumptions**: Assuming that because an ID is complex (e.g., UUID v4) or hidden in the UI, an attacker cannot guess or discover it.
3. **Missing Role-Based Access Control (RBAC)**: Failing to verify user roles (e.g., `ADMIN`, `MEMBER`) on sensitive administration routes or bulk mutation APIs.
4. **Parameter Pollution & Body Manipulation**: Verifying access against a URL path parameter but performing mutations using an unverified ID supplied in the JSON request body.

### Security Impact
- **Horizontal Privilege Escalation**: User A reads, updates, or deletes private data belonging to User B (e.g., invoices, profile details, private documents).
- **Vertical Privilege Escalation**: Standard user performs administrative functions (e.g., changing user roles, deleting accounts).
- **Data Breaches & Mass Exfiltration**: Attackers iterate through sequential IDs (`/api/documents/1`, `/api/documents/2`) to scrape all system records.

---

## 2. Detection Indicators

### Source-Code Patterns
- **Node.js / Express**:
  - `prisma.document.findUnique({ where: { id: req.params.id } })`
  - `db('orders').where({ id: req.params.orderId }).first()`
  - `User.findByIdAndUpdate(req.params.id, req.body)`
- **Python (FastAPI / Flask)**:
  - `db.query(Document).filter(Document.id == doc_id).first()`
  - `Document.objects.get(id=doc_id)`
  - `Document.query.get_or_404(doc_id)`

### Dangerous APIs & Patterns
- Direct primary-key lookups without `user_id` / `tenant_id` filters.
- Route handlers accessing `req.params.id` while ignoring `req.user` / `current_user`.
- Absence of authorization middleware or policy guards (`authorize()`, `checkPermission()`).

### Relevant Routes and Controllers
- `GET /api/documents/:id`
- `PUT /api/profile/:userId`
- `DELETE /api/orders/:orderId`
- `GET /api/invoices/download?id=123`
