---
id: kb:FILE-UPLOAD-01
externalId: CWE-434
vulnerabilityType: FILE_UPLOAD
cwe: CWE-434
severity: HIGH
sourceType: amass-kb
language: generic
framework: generic
sourceUrl: https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload
---

# Insecure File Upload: Overview and Detection Indicators

## 1. Vulnerability Definition

### What the Vulnerability Is
Insecure File Upload (CWE-434: Unrestricted Upload of File with Dangerous Type) occurs when a web application accepts user-submitted files without sufficiently validating properties such as filename, file extension, MIME type, file size, or internal content signature (magic bytes), and stores the file in a location accessible to the web server or execution environment.

### Typical Root Causes
1. **Unsanitized Filenames**: Trusting client-provided filenames (`req.file.originalname` or `file.filename`) directly in filesystem path construction (`path.join()` or `os.path.join()`).
2. **Web-Accessible Storage**: Saving uploaded files inside directories served directly as public static routes (e.g., `/public/uploads`, `/static/user_files`).
3. **Blacklist Validation**: Attempting to block specific extensions (e.g., blocking `.php` or `.py`) while missing alternatives (e.g., `.phtml`, `.pyc`, `.html`, `.svg`).
4. **Header-Only MIME Checking**: Relying solely on the HTTP `Content-Type` header supplied by the client.
5. **Path Traversal Vulnerabilities**: Failing to strip path traversal sequences (`../`, `..\`) from user-controlled filenames.

### Security Impact
- **Remote Code Execution (RCE)**: Attacker uploads an executable script or binary that is subsequently executed by the web server or application runtime.
- **Stored Cross-Site Scripting (Stored XSS)**: Attacker uploads HTML or SVG files containing inline scripts that execute in the browser context of users opening the file.
- **Arbitrary File Overwrite**: Attacker uses path traversal in the filename to overwrite critical system or application files.
- **Denial of Service (DoS)**: Uploading excessively large files or ZIP bombs to exhaust disk space or memory.

---

## 2. Detection Indicators

### Source-Code Patterns
Look for endpoints handling file payloads or multipart forms:
- **Express / Node.js**: Use of `multer`, `formidable`, `busboy`, or `express-fileupload`.
- **Python (FastAPI / Starlette / Flask)**: Use of `UploadFile`, `File(...)`, `request.files`, or `werkzeug.datastructures.FileStorage`.

### Dangerous APIs & Functions
- `fs.writeFile(path, req.file.buffer)`
- `fs.copyFile(req.file.path, destinationPath)`
- `open(os.path.join(upload_dir, file.filename), 'wb').write(file.file.read())`
- `shutil.copyfileobj(upload_file.file, target_path)`
- `file_storage.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))`

### Relevant Routes and Controllers
- `/api/v1/upload`
- `/api/users/avatar`
- `/api/documents/import`
- `/api/attachments`

### Configuration Indicators
- Mounting upload directories directly to static route handlers:
  - Express: `app.use('/uploads', express.static(path.join(__dirname, 'uploads')))`
  - FastAPI: `app.mount("/static/uploads", StaticFiles(directory="uploads"), name="static")`
  - Flask: `send_from_directory(app.config['UPLOAD_FOLDER'], filename)`
