import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"

const API = import.meta.env.VITE_API_URL || "http://localhost:3000"

const PlayerContext = createContext(null)

export function PlayerProvider({ children }) {
  const audioRef = useRef(null)

  const [current, setCurrent] = useState(null)
  const [queue, setQueue] = useState([])
  const [history, setHistory] = useState([])
  const [contextTracks, setContextTracks] = useState([])
  const [contextIndex, setContextIndex] = useState(-1)

  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)

  const [shuffle, setShuffle] = useState(false)
  const [repeat, setRepeat] = useState("off") // off | all | one

  function loadAndPlay(track) {
    const audio = audioRef.current
    if (!audio || !track) return

    audio.src = `${API}/stream/${track.id}`
    audio.play().catch(console.error)
    setCurrent(track)
  }

  function playTrack(track, options = {}) {
    const {
      context = [],
      index = -1,
      replaceQueue = false,
    } = options

    if (replaceQueue) setQueue([])
    if (context.length) {
      setContextTracks(context)
      setContextIndex(index)
    }

    if (current) {
      setHistory((prev) => [...prev, current])
    }

    loadAndPlay(track)
  }

  function addToQueue(track) {
    setQueue((prev) => [...prev, track])
  }

  function playNextNow(track) {
    setQueue((prev) => [track, ...prev])
  }

  function getNextContextTrack() {
    if (!contextTracks.length || contextIndex < 0) return null

    if (shuffle) {
      const remaining = contextTracks.filter((t) => t.id !== current?.id)
      if (!remaining.length) return null
      return remaining[Math.floor(Math.random() * remaining.length)]
    }

    const nextIndex = contextIndex + 1
    if (nextIndex < contextTracks.length) {
      setContextIndex(nextIndex)
      return contextTracks[nextIndex]
    }

    if (repeat === "all" && contextTracks.length > 0) {
      setContextIndex(0)
      return contextTracks[0]
    }

    return null
  }

  function nextTrack() {
    if (repeat === "one" && current) {
      loadAndPlay(current)
      return
    }

    if (queue.length > 0) {
      const [next, ...rest] = queue
      setQueue(rest)
      if (current) setHistory((prev) => [...prev, current])
      loadAndPlay(next)
      return
    }

    const nextFromContext = getNextContextTrack()
    if (nextFromContext) {
      if (current) setHistory((prev) => [...prev, current])
      loadAndPlay(nextFromContext)
      return
    }

    setIsPlaying(false)
  }

  function previousTrack() {
    const audio = audioRef.current
    if (!audio) return

    if (audio.currentTime > 3) {
      audio.currentTime = 0
      return
    }

    if (!history.length) return

    const prev = history[history.length - 1]
    setHistory((h) => h.slice(0, -1))
    loadAndPlay(prev)
  }

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return

    if (!current) return

    if (audio.paused) {
      audio.play().catch(console.error)
    } else {
      audio.pause()
    }
  }

  function seek(value) {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = value
    setProgress(value)
  }

  function setAudioVolume(value) {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = value
    setVolume(value)
  }

  function removeFromQueue(index) {
    setQueue((prev) => prev.filter((_, i) => i !== index))
  }

  function clearQueue() {
    setQueue([])
  }

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTimeUpdate = () => setProgress(audio.currentTime || 0)
    const onDurationChange = () => setDuration(audio.duration || 0)
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onEnded = () => nextTrack()

    audio.addEventListener("timeupdate", onTimeUpdate)
    audio.addEventListener("durationchange", onDurationChange)
    audio.addEventListener("play", onPlay)
    audio.addEventListener("pause", onPause)
    audio.addEventListener("ended", onEnded)

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate)
      audio.removeEventListener("durationchange", onDurationChange)
      audio.removeEventListener("play", onPlay)
      audio.removeEventListener("pause", onPause)
      audio.removeEventListener("ended", onEnded)
    }
  }, [current, queue, contextTracks, contextIndex, repeat, shuffle])

  const upNext = useMemo(() => {
    if (queue.length > 0) return queue

    if (!contextTracks.length || contextIndex < 0) return []

    return contextTracks.slice(contextIndex + 1)
  }, [queue, contextTracks, contextIndex])

  const value = {
    audioRef,
    current,
    queue,
    upNext,
    isPlaying,
    progress,
    duration,
    volume,
    shuffle,
    repeat,

    playTrack,
    addToQueue,
    playNextNow,
    nextTrack,
    previousTrack,
    togglePlay,
    seek,
    setAudioVolume,
    removeFromQueue,
    clearQueue,
    setShuffle,
    setRepeat,
  }

  return (
    <PlayerContext.Provider value={value}>
      <audio ref={audioRef} preload="metadata" />
      {children}
    </PlayerContext.Provider>
  )
}

export function usePlayer() {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider")
  return ctx
}