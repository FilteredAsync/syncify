// syncify-ui/src/App.jsx
import React, { useEffect, useMemo, useRef, useState } from "react"
import "./styles.css"

// If you ever change your server port, update this.
const API = "http://localhost:3000"

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, "0")}`
}

async function fetchJson(url) {
  const res = await fetch(url)
  const ct = res.headers.get("content-type") || ""
  // Guard against accidentally trying to parse images/html as JSON
  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "")
    throw new Error(`Expected JSON from ${url}, got ${ct}. Body starts: ${text.slice(0, 40)}`)
  }
  return res.json()
}

function Cover({ artist, album, coverUrl, className = "" }) {
  // coverUrl is returned by server as "/cover?artist=...&album=..."
  // We can use it directly.
  const src = coverUrl ? `${API}${coverUrl}` : `${API}/cover?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`

  return (
    <div className={`coverBox ${className}`}>
      <img
        className="coverImg"
        src={src}
        alt={`${album} cover`}
        onError={(e) => {
          e.currentTarget.style.display = "none"
        }}
      />
    </div>
  )
}

export default function App() {
  // Global library
  const [albums, setAlbums] = useState([])
  const [loadingAlbums, setLoadingAlbums] = useState(true)
  const [albumsError, setAlbumsError] = useState("")

  // Search
  const [query, setQuery] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchTracks, setSearchTracks] = useState([])
  const [searchAlbums, setSearchAlbums] = useState([])

  // “Routing” state
  // view = { kind: "home" } or { kind: "album", artist, album }
  const [view, setView] = useState({ kind: "home" })

  // Album detail state
  const [albumLoading, setAlbumLoading] = useState(false)
  const [albumData, setAlbumData] = useState(null)
  const [albumError, setAlbumError] = useState("")

  // Player
  const audioRef = useRef(null)
  const [currentTrack, setCurrentTrack] = useState(null) // { id, title/name, artist, album, duration }
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0) // seconds
  const [duration, setDuration] = useState(0) // seconds

  // -------------------- Load Albums --------------------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoadingAlbums(true)
      setAlbumsError("")
      try {
        const data = await fetchJson(`${API}/albums`)
        if (!cancelled) setAlbums(Array.isArray(data) ? data : [])
      } catch (e) {
        console.error(e)
        if (!cancelled) {
          setAlbums([])
          setAlbumsError(String(e?.message || e))
        }
      } finally {
        if (!cancelled) setLoadingAlbums(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // -------------------- Search --------------------
  useEffect(() => {
    if (!query.trim()) {
      setSearchTracks([])
      setSearchAlbums([])
      setSearchLoading(false)
      return
    }

    let cancelled = false
    const t = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const data = await fetchJson(`${API}/search?q=${encodeURIComponent(query.trim())}`)
        if (cancelled) return
        setSearchTracks(Array.isArray(data?.tracks) ? data.tracks : [])
        setSearchAlbums(Array.isArray(data?.albums) ? data.albums : [])
      } catch (e) {
        console.error(e)
        if (!cancelled) {
          setSearchTracks([])
          setSearchAlbums([])
        }
      } finally {
        if (!cancelled) setSearchLoading(false)
      }
    }, 180)

    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  // -------------------- Album Open --------------------
  async function openAlbum(artist, album) {
    setView({ kind: "album", artist, album })
    setAlbumLoading(true)
    setAlbumData(null)
    setAlbumError("")

    try {
      // IMPORTANT: this is the JSON endpoint (NOT coverUrl)
      const data = await fetchJson(
        `${API}/album?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`
      )
      setAlbumData(data)
    } catch (e) {
      console.error(e)
      setAlbumError(String(e?.message || e))
    } finally {
      setAlbumLoading(false)
    }
  }

  function goHome() {
    setView({ kind: "home" })
    setAlbumData(null)
    setAlbumError("")
    setAlbumLoading(false)
  }

  // -------------------- Player --------------------
  function playTrack(track) {
    const audio = audioRef.current
    if (!audio) return

    const id = track.id
    audio.src = `${API}/stream/${id}`
    audio.play().then(() => setIsPlaying(true)).catch((e) => {
      console.error("play() failed:", e)
      setIsPlaying(false)
    })

    setCurrentTrack({
      id,
      title: track.title || track.name || "Unknown Title",
      artist: track.artist || "Unknown Artist",
      album: track.album || "Unknown Album",
      duration: track.duration || 0,
    })
  }

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    if (!audio.src) return

    if (audio.paused) {
      audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false))
    } else {
      audio.pause()
      setIsPlaying(false)
    }
  }

  function seekTo(seconds) {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || seconds))
    setProgress(audio.currentTime)
  }

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTime = () => setProgress(audio.currentTime || 0)
    const onDur = () => setDuration(audio.duration || 0)
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)

    audio.addEventListener("timeupdate", onTime)
    audio.addEventListener("durationchange", onDur)
    audio.addEventListener("play", onPlay)
    audio.addEventListener("pause", onPause)

    return () => {
      audio.removeEventListener("timeupdate", onTime)
      audio.removeEventListener("durationchange", onDur)
      audio.removeEventListener("play", onPlay)
      audio.removeEventListener("pause", onPause)
    }
  }, [])

  const albumGrid = useMemo(() => {
    return Array.isArray(albums) ? albums : []
  }, [albums])

  return (
    <div className="app">
      <audio ref={audioRef} />

      {/* Top bar */}
      <header className="topbar">
        <div className="brand" onClick={goHome} style={{ cursor: "pointer" }}>
          Syncify
        </div>

        <div className="searchWrap">
          <input
            className="search"
            placeholder="Search songs, artists, albums..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSearchOpen(true)
            }}
            onFocus={() => setSearchOpen(true)}
          />

          {searchOpen && query.trim().length > 0 && (
            <div className="searchPanel" onMouseDown={(e) => e.preventDefault()}>
              {searchLoading && <div className="searchEmpty">Searching…</div>}

              {!searchLoading && searchAlbums.length === 0 && searchTracks.length === 0 && (
                <div className="searchEmpty">No results.</div>
              )}

              {searchAlbums.length > 0 && (
                <div className="searchSection">
                  <div className="searchSectionTitle">Albums</div>
                  <div className="searchList">
                    {searchAlbums.map((a) => (
                      <button
                        key={a.albumId}
                        className="searchRow"
                        onClick={() => {
                          setSearchOpen(false)
                          openAlbum(a.artist, a.album)
                        }}
                      >
                        <div className="searchCover">
                          <Cover artist={a.artist} album={a.album} coverUrl={a.coverUrl} />
                        </div>
                        <div className="searchMeta">
                          <div className="searchTitle">{a.album}</div>
                          <div className="searchSub">{a.artist}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {searchTracks.length > 0 && (
                <div className="searchSection">
                  <div className="searchSectionTitle">Songs</div>
                  <div className="searchList">
                    {searchTracks.map((t) => (
                      <button
                        key={t.id}
                        className="searchRow"
                        onClick={() => {
                          setSearchOpen(false)
                          playTrack(t)
                        }}
                      >
                        <div className="searchMeta" style={{ paddingLeft: 6 }}>
                          <div className="searchTitle">{t.name}</div>
                          <div className="searchSub">
                            {t.artist} • {t.album}
                          </div>
                        </div>
                        <div className="searchRight">{fmtTime(t.duration)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Main */}
      <main className="main">
        {view.kind === "home" && (
          <>
            <div className="sectionTitle">Albums</div>

            {loadingAlbums && <div className="muted">Loading…</div>}
            {!loadingAlbums && albumsError && <div className="muted">Error: {albumsError}</div>}

            {!loadingAlbums && !albumsError && (
              <div className="grid">
                {albumGrid.map((a) => (
                  <button
                    key={a.albumId}
                    className="card"
                    onClick={() => openAlbum(a.artist, a.album)}
                  >
                    <Cover artist={a.artist} album={a.album} coverUrl={a.coverUrl} />
                    <div className="cardTitle">{a.album}</div>
                    <div className="cardSub">{a.artist}</div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {view.kind === "album" && (
          <>
            <div className="albumTop">
              <button className="backBtn" onClick={goHome}>← Back</button>

              {albumLoading && <div className="muted">Loading album…</div>}

              {!albumLoading && albumError && (
                <div className="muted">Album error: {albumError}</div>
              )}

              {!albumLoading && albumData && (
                <div className="albumHeader">
                  <div className="albumCoverLg">
                    <Cover
                      artist={albumData.artist}
                      album={albumData.album}
                      coverUrl={albumData.coverUrl}
                      className="coverLg"
                    />
                  </div>

                  <div className="albumMeta">
                    <div className="albumName">{albumData.album}</div>
                    <div className="albumArtist">{albumData.artist}</div>
                    <div className="albumCounts">
                      {albumData.tracks?.length || 0} songs
                    </div>
                  </div>
                </div>
              )}
            </div>

            {!albumLoading && albumData && (
              <div className="trackList">
                {(albumData.tracks || []).map((t, idx) => (
                  <button
                    key={t.id}
                    className="trackRow"
                    onClick={() =>
                      playTrack({
                        id: t.id,
                        title: t.title,
                        artist: albumData.artist, // album artist for display
                        album: albumData.album,
                        duration: t.duration,
                      })
                    }
                  >
                    <div className="trackLeft">
                      <div className="trackIdx">{t.trackNo || idx + 1}</div>
                      <div className="trackTitle">{t.title}</div>
                    </div>
                    <div className="trackRight">{fmtTime(t.duration)}</div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Player bar */}
      <footer className="player">
        <div className="playerLeft">
          {currentTrack ? (
            <>
              <div className="nowTitle">{currentTrack.title}</div>
              <div className="nowSub">
                {currentTrack.artist} • {currentTrack.album}
              </div>
            </>
          ) : (
            <div className="muted">Pick a song…</div>
          )}
        </div>

        <div className="playerMid">
          <button className="playBtn" onClick={togglePlay} disabled={!currentTrack}>
            {isPlaying ? "Pause" : "Play"}
          </button>
        </div>

        <div className="playerRight">
          <div className="time">{fmtTime(progress)}</div>
          <input
            className="seek"
            type="range"
            min="0"
            max={Math.max(0, duration || 0)}
            value={Math.min(progress, duration || 0)}
            onChange={(e) => seekTo(Number(e.target.value))}
            disabled={!currentTrack}
          />
          <div className="time">{fmtTime(duration)}</div>
        </div>
      </footer>
    </div>
  )
}