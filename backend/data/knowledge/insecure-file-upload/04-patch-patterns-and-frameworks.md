---
id: kb:FILE-UPLOAD-04
externalId: CWE-434
vulnerabilityType: FILE_UPLOAD
cwe: CWE-434
severity: HIGH
sourceType: amass-kb
language: javascript,python
framework: express,fastapi,flask
sourceUrl: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
---

# Insecure File Upload: Patch Patterns and Framework-Specific Guidance

## 5. Localized Patch Patterns

### Pattern A: Node.js / Express (Multer / File System)

#### Vulnerable Code (Before)
```javascript
const path = require('path');
const fs = require('fs');

app.post('/api/upload', upload.single('file'), (req, res) => {
  // UNSAFE: Using originalname directly in destination path
  const targetPath = path.join(__dirname, 'public/uploads', req.file.originalname);
  fs.writeFileSync(targetPath, req.file.buffer);
  res.json({ url: `/uploads/${req.file.originalname}` });
});
```

#### Secure Remediation Patch (After)
```javascript
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.pdf']);

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return res.status(400).json({ error: 'Invalid file extension' });
  }

  // SECURE: Random UUID filename and sanitized extension
  const safeFilename = `${crypto.randomUUID()}${ext}`;
  const uploadDir = path.join(__dirname, '../storage/uploads'); // Outside public root
  fs.mkdirSync(uploadDir, { recursive: true });

  const targetPath = path.join(uploadDir, safeFilename);
  fs.writeFileSync(targetPath, req.file.buffer);
  
  res.json({ fileId: safeFilename });
});
```

---

### Pattern B: Python / FastAPI

#### Vulnerable Code (Before)
```python
import os
from fastapi import FastAPI, UploadFile, File

app = FastAPI()

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    # UNSAFE: Joining user-provided filename directly to static directory
    upload_path = os.path.join("static/uploads", file.filename)
    with open(upload_path, "wb") as buffer:
        buffer.write(await file.read())
    return {"filename": file.filename, "url": f"/static/uploads/{file.filename}"}
```

#### Secure Remediation Patch (After)
```python
import os
import uuid
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, HTTPException

app = FastAPI()

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".pdf"}
UPLOAD_DIR = Path("storage/uploads") # Outside static web root

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Empty filename")

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported file format")

    # SECURE: Generate random UUID filename and ensure upload directory exists
    safe_filename = f"{uuid.uuid4()}{ext}"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    target_path = UPLOAD_DIR / safe_filename

    contents = await file.read()
    with open(target_path, "wb") as f:
        f.write(contents)

    return {"file_id": safe_filename}
```

---

### Pattern C: Python / Flask

#### Vulnerable Code (Before)
```python
import os
from flask import Flask, request

app = Flask(__name__)

@app.route('/upload', methods=['POST'])
def upload():
    file = request.files['file']
    # UNSAFE: Using file.filename directly
    file.save(os.path.join('uploads', file.filename))
    return 'Uploaded'
```

#### Secure Remediation Patch (After)
```python
import os
import uuid
from flask import Flask, request, jsonify
from werkzeug.utils import secure_filename

app = Flask(__name__)
ALLOWED_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.pdf'}

@app.route('/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    file = request.files['file']
    if not file or file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({'error': 'File type not allowed'}), 400

    # SECURE: Random UUID filename with werkzeug secure extension
    safe_filename = f"{uuid.uuid4()}{ext}"
    upload_dir = os.path.join(app.root_path, '../storage_uploads')
    os.makedirs(upload_dir, exist_ok=True)

    file.save(os.path.join(upload_dir, safe_filename))
    return jsonify({'file_id': safe_filename}), 200
```
