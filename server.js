// server.js
// Syncify Server (Google Drive -> local cache -> SQLite -> API -> UI)
// Supports .mp3 + .flac
// Features:
// - Indexes a Google Drive folder (service account, drive.readonly)
// - Downloads audio to ./cache
// - Extracts metadata (title/artist/album/duration)
// - Builds a Spotify-ish API: /albums, /album, /search, /library
// - Streams audio with Range support: /stream/:id
// - Extracts embedded cover art (no sharp) into ./covers
// - Serves covers: /cover?artist=...&album=...

require("dotenv").config()

const express = require("express")
const cors = require("cors")
const fs = require("fs")
const path = require("path")
const { google } = require("googleapis")
const mm = require("music-metadata")
const Database = require("better-sqlite3")

// -------------------- Config --------------------
const PORT = Number(process.env.PORT || 3000)
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID
const SERVICE_ACCOUNT_PATH = path.join(__dirname, "service-account.json")

if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  fs.writeFileSync(
    SERVICE_ACCOUNT_PATH,
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    "utf8"
  )
  console.log("Wrote service account JSON to:", SERVICE_ACCOUNT_PATH)
} else {
  console.log("GOOGLE_SERVICE_ACCOUNT_JSON is missing")
}
// -------------------- Directories --------------------
const CACHE_DIR = path.join(__dirname, "cache")
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true })

const COVERS_DIR = path.join(__dirname, "covers")
if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true })

// -------------------- DB --------------------
const db = new Database("library.db")

db.prepare(`
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  driveName TEXT,
  artist TEXT,
  albumArtist TEXT,
  album TEXT,
  title TEXT,
  trackNo INTEGER,
  duration REAL,
  ext TEXT,
  mimeType TEXT,
  modifiedTime TEXT,
  filePath TEXT
)
`).run()

db.prepare(`CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist)`).run()
db.prepare(`CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album)`).run()
db.prepare(`CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title)`).run()
db.prepare(`CREATE INDEX IF NOT EXISTS idx_tracks_albumArtist ON tracks(albumArtist)`).run()

// -------------------- Drive Client --------------------
const auth = new google.auth.GoogleAuth({
  keyFile: SERVICE_ACCOUNT_PATH,
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
})

const drive = google.drive({ version: "v3", auth })

// -------------------- Helpers --------------------
function ensureColumn(table, colName, colType) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  const exists = cols.some(c => c.name === colName)
  if (!exists) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colType}`).run()
    console.log(`DB migrated: added ${table}.${colName}`)
  }
}

ensureColumn("tracks", "albumArtist", "TEXT")
ensureColumn("tracks", "trackNo", "INTEGER")

function normalizeStr(s, fallback) {
  if (typeof s !== "string") return fallback
  const t = s.trim()
  return t.length > 0 ? t : fallback
}

function isSupportedAudioName(name) {
  const ext = path.extname(name).toLowerCase()
  return ext === ".mp3" || ext === ".flac"
}

function contentTypeForExt(ext) {
  switch (ext) {
    case ".flac":
      return "audio/flac"
    case ".mp3":
      return "audio/mpeg"
    default:
      return "application/octet-stream"
  }
}

function safeFileName(s) {
  // Windows-safe file name
  return s.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
}

function albumKey(artist, album) {
  return `${normalizeStr(artist, "Unknown Artist")}|||${normalizeStr(album, "Unknown Album")}`
}

function coverBasePath(albumId) {
  return path.join(COVERS_DIR, safeFileName(albumId))
}

function coverExists(albumId) {
  const base = coverBasePath(albumId)
  return fs.existsSync(base + ".jpg") || fs.existsSync(base + ".png") || fs.existsSync(base + ".webp")
}

function coverUrlFor(artist, album) {
  return `/cover?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`
}

function writeCoverFromMetadataIfNeeded(albumId, meta) {
  const pics = meta?.common?.picture
  if (!pics || pics.length === 0) return false

  if (coverExists(albumId)) return true

  const pic = pics[0]
  const mime = String(pic.format || "").toLowerCase() // e.g. "image/jpeg"
  let ext = ".jpg"
  if (mime.includes("png")) ext = ".png"
  else if (mime.includes("webp")) ext = ".webp"
  else if (mime.includes("jpeg") || mime.includes("jpg")) ext = ".jpg"

  const outPath = coverBasePath(albumId) + ext
  fs.writeFileSync(outPath, pic.data)
  return true
}

async function listDriveFolderAllPages(folderId) {
  const out = []
  let pageToken = undefined
  const q = `'${folderId}' in parents and trashed=false`

  do {
    const res = await drive.files.list({
      q,
      fields: "nextPageToken, files(id,name,mimeType,modifiedTime,size)",
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })

    out.push(...(res.data.files || []))
    pageToken = res.data.nextPageToken || undefined
  } while (pageToken)

  return out
}

async function downloadDriveFileToPath(fileId, destPath) {
  const tmpPath = destPath + ".tmp"
  const dest = fs.createWriteStream(tmpPath)

  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "stream" }
  )

  await new Promise((resolve, reject) => {
    res.data.pipe(dest)
    dest.on("finish", resolve)
    dest.on("error", reject)
    res.data.on("error", reject)
  })

  fs.renameSync(tmpPath, destPath)
}

async function generateCoverFromCachedTrackIfMissing(trackRow) {
  if (!trackRow?.filePath || !fs.existsSync(trackRow.filePath)) return
 const aId = albumKey(trackRow.albumArtist, trackRow.album)
  if (coverExists(aId)) return

  try {
    const meta = await mm.parseFile(trackRow.filePath, { duration: false })
    const ok = writeCoverFromMetadataIfNeeded(aId, meta)
    if (ok) console.log("Generated cover for:", aId)
    else console.log("No embedded cover for:", aId)
  } catch (e) {
    console.warn("Cover generation failed for:", aId, "-", e?.message || e)
  }
}

async function indexDriveFolder() {
  console.log("Indexing Google Drive folder:", DRIVE_FOLDER_ID)

  const files = await listDriveFolderAllPages(DRIVE_FOLDER_ID)
  const audioFiles = files.filter((f) => f?.name && isSupportedAudioName(f.name))

  console.log(`Found ${audioFiles.length} audio file(s) (.mp3/.flac).`)

  for (const f of audioFiles) {
    const id = f.id
    const name = f.name
    const ext = path.extname(name).toLowerCase()
    const mimeType = f.mimeType || ""
    const modifiedTime = f.modifiedTime || ""

    const existing = db
      .prepare("SELECT id, modifiedTime, filePath, artist, albumArtist, album FROM tracks WHERE id=?")
      .get(id)

    // If already indexed and unchanged + cached file exists:
    if (existing && existing.modifiedTime === modifiedTime && existing.filePath && fs.existsSync(existing.filePath)) {
      // NEW: still generate cover if missing (so adding cover support later works)
      await generateCoverFromCachedTrackIfMissing(existing)
      continue
    }

    console.log("Syncing:", name)

    // Download/refresh cache using the real extension
    const filePath = path.join(CACHE_DIR, `${id}${ext}`)
    await downloadDriveFileToPath(id, filePath)

    // Parse metadata
    let meta = null
    try {
      meta = await mm.parseFile(filePath, { duration: true })
    } catch (err) {
      console.warn("Metadata parse failed for", name, "-", err?.message || err)
      meta = null
    }

    // IMPORTANT: define title/artist/album BEFORE using them
    const title = normalizeStr(meta?.common?.title, name)
    const trackArtist = normalizeStr(meta?.common?.artist, "Unknown Artist")
    const albumArtist = normalizeStr(meta?.common?.albumartist, trackArtist)
    const album = normalizeStr(meta?.common?.album, "Unknown Album")
    const duration = Number(meta?.format?.duration || 0)
    const trackNo = Number(meta?.common?.track?.no || 0)

    const aId = albumKey(albumArtist, album)
    try {
      const ok = writeCoverFromMetadataIfNeeded(aId, meta)
      if (ok) console.log("Cover OK for:", aId)
      else console.log("No embedded cover for:", aId)
    } catch (e) {
      console.warn("Cover extraction failed for:", aId, "-", e?.message || e)
    }

    // Upsert
    db.prepare(`
      INSERT INTO tracks (id, driveName, artist, albumArtist, album, title, trackNo, duration, ext, mimeType, modifiedTime, filePath)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        driveName=excluded.driveName,
        artist=excluded.artist,
        albumArtist=excluded.albumArtist,
        album=excluded.album,
        title=excluded.title,
        trackNo=excluded.trackNo,
        duration=excluded.duration,
        ext=excluded.ext,
        mimeType=excluded.mimeType,
        modifiedTime=excluded.modifiedTime,
        filePath=excluded.filePath
    `).run(
      id,
      name,
      trackArtist,
      albumArtist,
      album,
      title,
      trackNo,
      duration,
      ext,
      mimeType,
      modifiedTime,
      filePath
    )

    console.log(`Indexed: ${albumArtist} — ${title}`)
  }

  console.log("Index complete.")
}

// -------------------- Server --------------------
const app = express()
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://syncify-lac.vercel.app"
  ]
}))
app.use(express.json())

app.get("/health", (req, res) => res.json({ok: true}))

// Flat library (safe fields only)
app.get("/library", (req, res) => {
  const tracks = db.prepare(`
    SELECT id, title as name, artist, album, duration
    FROM tracks
    ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, title COLLATE NOCASE
  `).all()

  res.json(tracks)
})

// Albums grid
app.get("/albums", (req, res) => {
  const rows = db.prepare(`
    SELECT id, albumArtist, album, duration
    FROM tracks
  `).all()

  const map = new Map()
  for (const t of rows) {
    const artist = normalizeStr(t.albumArtist, "Unknown Artist")
    const album = normalizeStr(t.album, "Unknown Album")
    const key = `${artist}|||${album}`

    if (!map.has(key)) {
      map.set(key, {
        albumId: key,
        artist,
        album,
        trackCount: 0,
        totalDuration: 0,
        sampleTrackId: t.id,
        coverUrl: coverUrlFor(artist, album),
      })
    }

    const a = map.get(key)
    a.trackCount += 1
    a.totalDuration += Number(t.duration || 0)
  }

  const albums = Array.from(map.values()).sort((a, b) => {
    const ac = a.artist.localeCompare(b.artist, undefined, { sensitivity: "base" })
    if (ac !== 0) return ac
    return a.album.localeCompare(b.album, undefined, { sensitivity: "base" })
  })

  res.json(albums)
})

// One album -> track list
app.get("/album", (req, res) => {
  if (!req.query.artist || !req.query.album) {
    return res.status(400).json({ error: "Missing ?artist= and/or ?album=" })
  }

  const artist = normalizeStr(String(req.query.artist || ""), "Unknown Artist")
  const album = normalizeStr(String(req.query.album || ""), "Unknown Album")

  const rows = db.prepare(`
    SELECT id, title, duration, trackNo
    FROM tracks
    WHERE COALESCE(albumArtist, 'Unknown Artist') = ?
      AND COALESCE(album, 'Unknown Album') = ?
    ORDER BY
      CASE WHEN trackNo IS NULL OR trackNo = 0 THEN 9999 ELSE trackNo END,
      title COLLATE NOCASE
  `).all(artist, album)

  res.json({
    artist,
    album,
    coverUrl: coverUrlFor(artist, album),
    tracks: rows.map((r) => ({
      id: r.id,
      title: r.title,
      duration: Number(r.duration || 0),
      trackNo: Number(r.trackNo || 0),
    }))
  })
})

// Search tracks + top albums
app.get("/search", (req, res) => {
  const q = String(req.query.q || "").trim()
  if (!q) return res.json({ tracks: [], albums: [] })

  const like = `%${q}%`

  const tracks = db.prepare(`
    SELECT id, title as name, artist, album, duration
    FROM tracks
    WHERE title LIKE ? OR artist LIKE ? OR album LIKE ?
    ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, title COLLATE NOCASE
    LIMIT 50
  `).all(like, like, like)

  const albums = db.prepare(`
    SELECT artist, album, COUNT(*) as trackCount
    FROM tracks
    WHERE title LIKE ? OR artist LIKE ? OR album LIKE ?
    GROUP BY artist, album
    ORDER BY trackCount DESC
    LIMIT 20
  `).all(like, like, like).map((r) => {
    const artist = normalizeStr(r.artist, "Unknown Artist")
    const album = normalizeStr(r.album, "Unknown Album")
    return {
      albumId: `${artist}|||${album}`,
      artist,
      album,
      trackCount: r.trackCount,
      coverUrl: coverUrlFor(artist, album),
    }
  })

  res.json({ tracks, albums })
})

// Serve cover art (embedded) for an album
app.get("/cover", (req, res) => {
  const artist = String(req.query.artist || "").trim()
  const album = String(req.query.album || "").trim()
  if (!artist || !album) return res.status(400).end()

  const id = albumKey(artist, album)
  const base = coverBasePath(id)

  const candidates = [base + ".jpg", base + ".png", base + ".webp"]
  const found = candidates.find((p) => fs.existsSync(p))

  if (!found) return res.sendStatus(404)

  const ext = path.extname(found).toLowerCase()
  const type =
    ext === ".png" ? "image/png" :
    ext === ".webp" ? "image/webp" :
    "image/jpeg"

  res.setHeader("Content-Type", type)
  fs.createReadStream(found).pipe(res)
})

// Stream with Range support (mp3 + flac)
app.get("/stream/:id", (req, res) => {
  const id = req.params.id
  const track = db.prepare(`
    SELECT id, filePath, ext
    FROM tracks
    WHERE id=?
  `).get(id)

  if (!track || !track.filePath || !fs.existsSync(track.filePath)) {
    return res.sendStatus(404)
  }

  const stat = fs.statSync(track.filePath)
  const ext = (track.ext || path.extname(track.filePath) || "").toLowerCase()
  const contentType = contentTypeForExt(ext)

  const range = req.headers.range
  if (!range) {
    res.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    })
    fs.createReadStream(track.filePath).pipe(res)
    return
  }

  const parts = String(range).replace(/bytes=/, "").split("-")
  const start = parseInt(parts[0], 10)
  const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1

  if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end < start) {
    return res.status(416).end()
  }

  const clampedEnd = Math.min(end, stat.size - 1)
  const chunkSize = clampedEnd - start + 1

  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${clampedEnd}/${stat.size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": chunkSize,
    "Content-Type": contentType,
  })

  fs.createReadStream(track.filePath, { start, end: clampedEnd }).pipe(res)
})

// Manual re-index trigger (handy while developing)
app.post("/reindex", async (req, res) => {
  try {
    await indexDriveFolder()
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ ok: false, error: err?.message || String(err) })
  }
})

// -------------------- Start --------------------
app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`)
  try {
    await indexDriveFolder()
  } catch (err) {
    console.error("Indexing failed:", err?.message || err)
    console.error("Tip: make sure the Drive folder is shared with your service account email.")
  }
})