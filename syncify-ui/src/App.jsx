import React, { useEffect, useMemo, useState } from "react"
import { PlayerProvider, usePlayer } from "./player/PlayerProvider"
import PlaybackBar from "./components/PlaybackBar"
import QueuePanel from "./components/QueuePanel"
import "./styles.css"

const API = import.meta.env.VITE_API_URL || "http://localhost:3000"

function Cover({ artist, album, coverUrl, className = "" }) {
  const safeArtist = (artist || "").trim()
  const safeAlbum = (album || "").trim()

  const isUnknown =
    !safeArtist ||
    !safeAlbum ||
    safeArtist === "Unknown Artist" ||
    safeAlbum === "Unknown Album"

  if (isUnknown) {
    return <div className={`coverBox ${className}`} />
  }

  const src = coverUrl
    ? `${API}${coverUrl}`
    : `${API}/cover?artist=${encodeURIComponent(safeArtist)}&album=${encodeURIComponent(safeAlbum)}`

  return (
    <div className={`coverBox ${className}`}>
      <img
        className="coverImg"
        src={src}
        alt={`${safeAlbum} cover`}
        onError={(e) => {
          e.currentTarget.style.display = "none"
        }}
      />
    </div>
  )
}

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, "0")}`
}

async function fetchJson(url) {
  const res = await fetch(url)
  const ct = res.headers.get("content-type") || ""

  if (!ct.includes("application/json")) {
    const text = await res.text().catch(() => "")
    throw new Error(`Expected JSON from ${url}, got ${ct}. Body starts: ${text.slice(0, 60)}`)
  }

  return res.json()
}

const backgroundCover =
  view.kind === "album" && albumData?.coverUrl
    ? `${API}${albumData.coverUrl}`
    : ""

function SyncifyApp() {
  const [albums, setAlbums] = useState([])
  const [loadingAlbums, setLoadingAlbums] = useState(true)
  const [albumsError, setAlbumsError] = useState("")

  const [query, setQuery] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchTracks, setSearchTracks] = useState([])
  const [searchAlbums, setSearchAlbums] = useState([])

  const [view, setView] = useState({ kind: "home" })
  const [albumLoading, setAlbumLoading] = useState(false)
  const [albumData, setAlbumData] = useState(null)
  const [albumError, setAlbumError] = useState("")

  const [queueOpen, setQueueOpen] = useState(true)

  const { playTrack, addToQueue, playNextNow } = usePlayer()

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      setLoadingAlbums(true)
      setAlbumsError("")

      try {
        const data = await fetchJson(`${API}/albums`)
        if (!cancelled) {
          setAlbums(Array.isArray(data) ? data : [])
        }
      } catch (err) {
        console.error(err)
        if (!cancelled) {
          setAlbums([])
          setAlbumsError(String(err?.message || err))
        }
      } finally {
        if (!cancelled) {
          setLoadingAlbums(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

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
      } catch (err) {
        console.error(err)
        if (!cancelled) {
          setSearchTracks([])
          setSearchAlbums([])
        }
      } finally {
        if (!cancelled) {
          setSearchLoading(false)
        }
      }
    }, 180)

    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query])

  async function openAlbum(artist, album) {
    setView({ kind: "album", artist, album })
    setAlbumLoading(true)
    setAlbumData(null)
    setAlbumError("")

    try {
      const data = await fetchJson(
        `${API}/album?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`
      )
      setAlbumData(data)
    } catch (err) {
      console.error(err)
      setAlbumError(String(err?.message || err))
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

  const albumGrid = useMemo(() => {
    return Array.isArray(albums) ? albums : []
  }, [albums])

  function makeAlbumContextTracks(data) {
    return (data?.tracks || []).map((t) => ({
      id: t.id,
      title: t.title,
      artist: data.artist,
      album: data.album,
      duration: t.duration,
      trackNo: t.trackNo || 0,
    }))
  }

  return (
    <div className="appShell">
  

      <div className="app">
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
                            playTrack({
                              id: t.id,
                              title: t.name,
                              artist: t.artist,
                              album: t.album,
                              duration: t.duration,
                            })
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

          <button className="queueToggleBtn" onClick={() => setQueueOpen((v) => !v)}>
            {queueOpen ? "Hide Queue" : "Show Queue"}
          </button>
        </header>

        <div className="layout">
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
                  <button className="backBtn" onClick={goHome}>
                    ← Back
                  </button>

                  {albumLoading && <div className="muted">Loading album…</div>}

                  {!albumLoading && albumError && (
                    <div className="muted">Album error: {albumError}</div>
                  )}

                  {!albumLoading && albumData && (
                    <>
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
                          <div className="albumLabel">Album</div>
                          <div className="albumName">{albumData.album}</div>
                          <div className="albumArtist">{albumData.artist}</div>
                          <div className="albumCounts">
                            {albumData.tracks?.length || 0} songs
                          </div>

                          <div className="albumActions">
                            <button
                              className="primaryBtn"
                              onClick={() => {
                                const contextTracks = makeAlbumContextTracks(albumData)
                                if (contextTracks.length === 0) return

                                playTrack(contextTracks[0], {
                                  context: contextTracks,
                                  index: 0,
                                })
                              }}
                            >
                              Play Album
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="trackList">
                        {(albumData.tracks || []).map((t, idx) => {
                          const contextTracks = makeAlbumContextTracks(albumData)

                          const track = {
                            id: t.id,
                            title: t.title,
                            artist: albumData.artist,
                            album: albumData.album,
                            duration: t.duration,
                            trackNo: t.trackNo || 0,
                          }

                          return (
                            <div key={t.id} className="trackRowWrap">
                              <button
                                className="trackRow"
                                onClick={() =>
                                  playTrack(track, {
                                    context: contextTracks,
                                    index: idx,
                                  })
                                }
                              >
                                <div className="trackLeft">
                                  <div className="trackIdx">{t.trackNo || idx + 1}</div>
                                  <div className="trackTitle">{t.title}</div>
                                </div>

                                <div className="trackRight">{fmtTime(t.duration)}</div>
                              </button>

                              <div className="trackActions">
                                <button
                                  className="ghostBtn"
                                  onClick={() => playNextNow(track)}
                                  title="Play next"
                                >
                                  Next
                                </button>
                                <button
                                  className="ghostBtn"
                                  onClick={() => addToQueue(track)}
                                  title="Add to queue"
                                >
                                  Queue
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </main>

          {queueOpen && (
            <aside className="sidebar">
              <QueuePanel />
            </aside>
          )}
        </div>

        <PlaybackBar />
      </div>
    </div>
  )
}

export default function App() {
  return (
    <PlayerProvider>
      <SyncifyApp />
    </PlayerProvider>
  )
}