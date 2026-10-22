const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const METADATA_FILE = path.join(UPLOADS_DIR, 'metadata.json');

class MediaLibrary {
  constructor(uploadsDir = UPLOADS_DIR) {
    this.uploadsDir = uploadsDir;
    this.metadataFile = path.join(this.uploadsDir, 'metadata.json');
    this._ensureUploadsDir();
    this.metadata = this._loadMetadata();
    this._syncExistingFiles();
  }

  _ensureUploadsDir() {
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
  }

  _loadMetadata() {
    try {
      if (fs.existsSync(this.metadataFile)) {
        const raw = fs.readFileSync(this.metadataFile, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('[MediaLibrary] Failed to parse metadata.json, creating new index.');
    }
    return {};
  }

  _saveMetadata() {
    try {
      fs.writeFileSync(this.metadataFile, JSON.stringify(this.metadata, null, 2), 'utf-8');
    } catch (e) {
      console.error('[MediaLibrary] Failed to save metadata.json:', e.message);
    }
  }

  _syncExistingFiles() {
    try {
      const files = fs.readdirSync(this.uploadsDir);
      let changed = false;

      for (const file of files) {
        if (file === 'metadata.json' || file.startsWith('.')) continue;

        const fullPath = path.join(this.uploadsDir, file);
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) continue;

        // If not already in metadata, register it
        if (!this.metadata[file]) {
          this.metadata[file] = {
            id: file,
            filename: file,
            originalName: file,
            size: stat.size,
            uploadedAt: stat.mtime.toISOString(),
            path: fullPath
          };
          changed = true;
        }
      }

      // Remove deleted files from metadata
      for (const id of Object.keys(this.metadata)) {
        const item = this.metadata[id];
        const fullPath = item.path || path.join(this.uploadsDir, item.filename || id);
        if (!fs.existsSync(fullPath)) {
          delete this.metadata[id];
          changed = true;
        }
      }

      if (changed) {
        this._saveMetadata();
      }
    } catch (e) {
      console.error('[MediaLibrary] Sync error:', e.message);
    }
  }

  registerFile(fileInfo) {
    const id = fileInfo.filename || path.basename(fileInfo.path);
    const item = {
      id,
      filename: path.basename(fileInfo.path),
      originalName: fileInfo.originalname || fileInfo.filename,
      size: fileInfo.size,
      mimeType: fileInfo.mimetype || 'video/mp4',
      uploadedAt: new Date().toISOString(),
      path: fileInfo.path
    };

    this.metadata[id] = item;
    this._saveMetadata();
    return item;
  }

  registerFiles(fileList) {
    return fileList.map((f) => this.registerFile(f));
  }

  getAll() {
    this._syncExistingFiles();
    return Object.values(this.metadata).sort((a, b) => {
      return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
    });
  }

  getById(id) {
    this._syncExistingFiles();
    return this.metadata[id] || null;
  }

  getLatest() {
    const all = this.getAll();
    return all.length > 0 ? all[0] : null;
  }

  delete(id) {
    this._syncExistingFiles();
    const item = this.metadata[id];
    if (!item) return false;

    const fullPath = item.path || path.join(UPLOADS_DIR, item.filename);
    try {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    } catch (e) {
      console.warn(`[MediaLibrary] Could not delete file ${fullPath}:`, e.message);
    }

    delete this.metadata[id];
    this._saveMetadata();
    return true;
  }
}

const mediaLibrary = new MediaLibrary();

module.exports = {
  MediaLibrary,
  mediaLibrary,
  UPLOADS_DIR
};
