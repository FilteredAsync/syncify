import React from "react"
import { usePlayer } from "../player/PlayerProvider"

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, "0")}`
}

export default function PlaybackBar() {
  const {
    current,
    isPlaying,
    progress,
    duration,
    volume,
    shuffle,
    repeat,
    togglePlay,
    previousTrack,
    nextTrack,
    seek,
    setAudioVolume,
    setShuffle,
    setRepeat,
  } = usePlayer()

  const repeatLabel = repeat === "off" ? "Off" : repeat === "all" ? "All" : "One"

  return (
    <footer className="playbackBar">
      <div className="pbNow">
        {current?.coverUrl && (
            <img className="pbCover" src={`${API}${current.coverUrl}`} alt={`${current?.album || "album"} cover`} />
        )}
        {current ? (
          <>
            <div className="pbMeta">
              <div className="pbTitle">{current.title}</div>
              <div className="pbSub">{current.artist}</div>
            </div>
          </>
        ) : (
          <div className="pbSub">Pick a song…</div>
        )}
      </div>

      <div className="pbCenter">
        <div className="pbControls">
          <button onClick={() => setShuffle(!shuffle)} className={shuffle ? "active" : ""}>Shuffle</button>
          <button onClick={previousTrack}>Prev</button>
          <button className="pbMainBtn" onClick={togglePlay}>
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button onClick={nextTrack}>Next</button>
          <button
            onClick={() => {
              setRepeat(repeat === "off" ? "all" : repeat === "all" ? "one" : "off")
            }}
            className={repeat !== "off" ? "active" : ""}
          >
            Repeat {repeatLabel}
          </button>
        </div>

        <div className="pbSeekRow">
          <span>{fmtTime(progress)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0)}
            value={Math.min(progress, duration || 0)}
            onChange={(e) => seek(Number(e.target.value))}
          />
          <span>{fmtTime(duration)}</span>
        </div>
      </div>

      <div className="pbRight">
        <span>Vol</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setAudioVolume(Number(e.target.value))}
        />
      </div>
    </footer>
  )
}