---
id: kb:FILE-UPLOAD-03
externalId: CWE-434
vulnerabilityType: FILE_UPLOAD
cwe: CWE-434
severity: HIGH
sourceType: amass-kb
language: generic
framework: generic
sourceUrl: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
---

# Insecure File Upload: Remediation Strategy and Security Boundaries

## 4. Remediation Principles

### Preferred Remediation (Gold Standard)
1. **Randomize Stored Filenames**: Never use client-supplied filenames for storage. Generate a cryptographically random unique identifier (UUID v4 or random hex string) and concatenate only a sanitized extension from an allowlist:
   - Node.js: `const safeName = `${crypto.randomUUID()}${ext}`;`
   - Python: `safe_name = f"{uuid.uuid4()}{ext}"`
2. **Strict Extension Allowlist**: Enforce a hard-coded allowlist of acceptable file extensions (e.g. `.jpg`, `.jpeg`, `.png`, `.pdf`). Reject all other extensions.
3. **Store Outside Web Root**: Save files to a dedicated storage directory situated outside the web server's document root (e.g., `/var/app/data/uploads` instead of `/app/public/uploads`), or upload directly to isolated cloud storage (Amazon S3, Google Cloud Storage) using presigned URLs.
4. **Sanitize Original Name**: If the original filename must be preserved for download metadata, sanitize it using `path.basename()` and strip all non-alphanumeric characters before storing in the database.

### Acceptable Alternative Remediation
If files must remain on the local disk inside a static directory:
- Disable execution permissions on the upload directory (`chmod 644` for files, `chmod 755` for directories).
- Configure the web server (Nginx / Apache / Express) to serve uploaded files with `Content-Disposition: attachment` and explicit, non-executable MIME types (`application/octet-stream`).

### Critical Edge Cases
- **Null Byte Injection**: Historical languages (`.php\0.jpg`). Modern runtimes handle this, but explicit extension extraction via `path.extname()` or `os.path.splitext()` is mandatory.
- **Double Extensions**: Files named `image.png.php` or `avatar.php.jpeg`. Always inspect the FINAL extension after `path.extname().toLowerCase()`.
- **Path Traversal in Filename**: Filenames containing `../` or absolute paths (`/etc/passwd`). Always wrap filename processing with `path.basename()`.
- **SVG / HTML Payload Injection**: SVG files can contain embedded `<script>` elements. Treat SVG files as untrusted HTML unless sanitized with an XML/SVG cleaner.

---

## Security Boundaries That Must Remain Intact

When Engineer generates a patch for file upload remediation, it MUST preserve:
1. **Controller Signature**: Router/controller parameter list and return schema must not be altered.
2. **File Processing Pipeline**: Image processing routines (e.g. Sharp, Pillow, Resizer) must receive valid buffer or file handle data without unexpected type mutations.
3. **Database Records**: Metadata records created in the database must retain relationship foreign keys (e.g. `userId`, `documentId`).
