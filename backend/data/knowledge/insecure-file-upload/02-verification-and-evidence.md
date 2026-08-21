---
id: kb:FILE-UPLOAD-02
externalId: CWE-434
vulnerabilityType: FILE_UPLOAD
cwe: CWE-434
severity: HIGH
sourceType: amass-kb
language: generic
framework: generic
sourceUrl: https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload
---

# Insecure File Upload: Verification Evidence and Exploitation Thresholds

## 3. Verification Evidence Requirements

To prevent false positives, AMASS must strictly distinguish between **suspicious code**, a **potential vulnerability**, and a **confirmed exploitability**.

### Level 1: Suspicious Code (Scanner / Static Analysis Signal)
- Scanner flags a file upload handler or multipart parser (`multer`, `UploadFile`, `request.files`).
- Source code reads `req.file.originalname` or `file.filename`.
- **Verdict**: Inconclusive. Code inspection required; do NOT mark as confirmed.

### Level 2: Potential Vulnerability (Planner Hypothesis)
- Source code accepts a multipart upload, extracts the client-supplied filename without strict validation, and writes it directly to disk inside or near a web-accessible directory.
- Extension checks are missing or use a weak blacklist.
- **Verdict**: Unconfirmed vulnerability candidate. Requires active exploit verification by Sniper.

### Level 3: Confirmed Exploitability (Sniper Verification Standard)
To confirm an Insecure File Upload vulnerability, the verification proof must meet **all three** of the following empirical criteria:

1. **Payload Acceptance**: The application accepts an HTTP POST/PUT multipart request containing an executable extension (e.g., `.py`, `.php`, `.html`, `.svg`) or path traversal sequences (`../../exploit.txt`) and responds with a success status code (HTTP 200/201/202).
2. **File Persistence**: The uploaded file is successfully written to the target filesystem location under the controlled filename or path.
3. **Execution or Direct Reachability**:
   - For **RCE**: Requesting the URL of the uploaded payload causes the server or application runtime to execute the code and return proof of execution in the HTTP response.
   - For **Path Traversal / Overwrite**: The file is confirmed to be written outside the designated upload directory (verified via filesystem check or HTTP response).
   - For **Stored XSS**: Requesting the uploaded HTML/SVG returns an `inline` Content-Disposition header with `text/html` or `image/svg+xml` MIME type and unescaped script content.

---

## Exploitation Proof Structure

When Sniper or Engineer validates an exploit for file upload, the evidence record must capture:
```json
{
  "indicator": "file_upload:rce_confirmed",
  "category": "exploit_proof",
  "httpStatus": 200,
  "detail": "Uploaded script at /static/uploads/poc_12345.py returned execution output: 'AMASS_EXPLOIT_SUCCESS'",
  "confidenceFactor": 0.95
}
```
