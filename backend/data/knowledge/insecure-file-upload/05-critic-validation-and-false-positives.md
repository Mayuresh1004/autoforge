---
id: kb:FILE-UPLOAD-05
externalId: CWE-434
vulnerabilityType: FILE_UPLOAD
cwe: CWE-434
severity: HIGH
sourceType: amass-kb
language: generic
framework: generic
sourceUrl: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
---

# Insecure File Upload: Critic Validation and False-Positive Guidance

## 6. Critic Validation Requirements

When Critic evaluates an Engineer-generated patch for an Insecure File Upload vulnerability, it must verify the patch against four testing dimensions:

### 1. Baseline Behavior Test
- Valid file upload requests (e.g. `image.png` with valid MIME type and binary contents within size limits) must succeed with HTTP 200/201.
- Response must return the expected metadata or reference payload without syntax or contract errors.

### 2. Security Regression Test (Malicious Inputs Rejected)
- Uploading files with forbidden extensions (`test.py`, `shell.php`, `script.html`, `executable.exe`, `payload.svg`) must return HTTP 400 or HTTP 422.
- Uploading filenames containing path traversal sequences (`../../etc/passwd`, `..\\..\\boot.ini`) must not write files outside the intended storage directory.

### 3. Functional Regression Test
- Existing non-upload routes or unrelated model attributes must not be mutated.
- Uploaded files must remain retrievable by authorized consumers using the assigned secure identifier.

### 4. Exploit Retest Expectations
- Resending the original Sniper exploit payload must result in refusal/rejection (`NOT_CONFIRMED` or `NOT_TESTED`) and zero code execution.

---

## 8. False-Positive Guidance

Static analysis tools (such as Bandit or Semgrep) often flag any code handling file uploads. AMASS must **NOT** assume every flagged file upload handler is vulnerable.

### Non-Exploitable Scenarios (False Positives)

1. **Cloud Object Storage Steaming**:
   - The application receives the upload stream and immediately transfers it to AWS S3 / Azure Blob / GCP Cloud Storage via official SDKs (`boto3`, `@aws-sdk/client-s3`).
   - Files are never saved to local web server disk.

2. **In-Memory Binary Processing Only**:
   - Uploaded files are parsed directly in memory (e.g., resizing an image with Sharp or Pillow using RAM buffers) and never written to disk.

3. **Strict UUID Renaming + Outside Web Root Storage**:
   - Filenames are replaced with `uuid.uuid4()` before writing to disk, AND the destination folder is not served by any static route handler.

4. **S3 Presigned URL Architecture**:
   - The API endpoint only generates presigned POST/PUT URLs for direct browser-to-cloud upload. The server itself never parses or stores the file.

### Critic Verification Check for False Positives
If Critic determines that any of the above mitigations are already present in the baseline code, it MUST reject patches that introduce redundant disk handlers or break existing S3/cloud integrations.
