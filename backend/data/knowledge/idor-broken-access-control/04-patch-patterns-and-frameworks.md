---
id: kb:IDOR-04
externalId: CWE-639
vulnerabilityType: BROKEN_ACCESS_CONTROL
cwe: CWE-639
severity: HIGH
sourceType: amass-kb
language: javascript,python
framework: express,fastapi,flask
sourceUrl: https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_References_Prevention_Cheat_Sheet.html
---

# IDOR and Broken Access Control: Patch Patterns and Framework Guidance

## 5. Localized Patch Patterns

### Pattern A: Node.js / Express (Prisma ORM)

#### Vulnerable Code (Before)
```javascript
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const app = express();

app.get('/api/documents/:id', requireAuth, async (req, res) => {
  // UNSAFE: Querying solely by document ID without checking ownership
  const document = await prisma.document.findUnique({
    where: { id: req.params.id }
  });
  if (!document) return res.status(404).json({ error: 'Not found' });
  res.json(document);
});
```

#### Secure Remediation Patch (After)
```javascript
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const app = express();

app.get('/api/documents/:id', requireAuth, async (req, res) => {
  // SECURE: Scoping query to match both document ID AND authenticated user ID
  const document = await prisma.document.findFirst({
    where: {
      id: req.params.id,
      userId: req.user.id
    }
  });
  if (!document) {
    return res.status(404).json({ error: 'Document not found or access denied' });
  }
  res.json(document);
});
```

---

### Pattern B: Python / FastAPI (SQLAlchemy)

#### Vulnerable Code (Before)
```python
from fastapi import FastAPI, Depends, HTTPException, status
from sqlalchemy.orm import Session
from .database import get_db, Document, get_current_user

app = FastAPI()

@app.get("/api/documents/{doc_id}")
def get_document(doc_id: str, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    # UNSAFE: Querying Document by doc_id only
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc
```

#### Secure Remediation Patch (After)
```python
from fastapi import FastAPI, Depends, HTTPException, status
from sqlalchemy.orm import Session
from .database import get_db, Document, get_current_user

app = FastAPI()

@app.get("/api/documents/{doc_id}")
def get_document(doc_id: str, db: Session = Depends(get_db), current_user = Depends(get_current_user)):
    # SECURE: Adding ownership filter (Document.owner_id == current_user.id)
    doc = db.query(Document).filter(
        Document.id == doc_id,
        Document.owner_id == current_user.id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found or access denied")
    return doc
```

---

### Pattern C: Python / Flask (Flask-SQLAlchemy)

#### Vulnerable Code (Before)
```python
from flask import Flask, jsonify, g
from .models import db, Note
from .auth import login_required

app = Flask(__name__)

@app.route('/notes/<int:note_id>', methods=['DELETE'])
@login_required
def delete_note(note_id):
    # UNSAFE: Deleting note by ID without verifying owner
    note = Note.query.get_or_404(note_id)
    db.session.delete(note)
    db.session.commit()
    return jsonify({'status': 'deleted'})
```

#### Secure Remediation Patch (After)
```python
from flask import Flask, jsonify, g
from .models import db, Note
from .auth import login_required

app = Flask(__name__)

@app.route('/notes/<int:note_id>', methods=['DELETE'])
@login_required
def delete_note(note_id):
    # SECURE: Explicitly verify note ownership against logged-in user
    note = Note.query.filter_by(id=note_id, user_id=g.user.id).first()
    if not note:
        return jsonify({'error': 'Note not found or access denied'}), 404
    db.session.delete(note)
    db.session.commit()
    return jsonify({'status': 'deleted'})
```
