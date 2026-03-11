import React from "react"
import { usePlayer } from "../player/PlayerProvider"

export default function QueuePanel() {
  const { current, upNext, queue, removeFromQueue, clearQueue } = usePlayer()

  return (
    <aside className="queuePanel">
      <h3>Now Playing</h3>

      {current ? (
        <div className="queueCurrent">
          <div className="queueTitle">{current.title}</div>
          <div className="queueSub">{current.artist}</div>
        </div>
      ) : (
        <div className="queueSub">Nothing playing</div>
      )}

      <div className="queueHeader">
        <h4>Next Up</h4>
        {queue.length > 0 && <button onClick={clearQueue}>Clear Queue</button>}
      </div>

      {upNext.length === 0 ? (
        <div className="queueSub">Nothing left in queue</div>
      ) : (
        <div className="queueList">
          {upNext.map((track, i) => (
            <div key={`${track.id}-${i}`} className="queueItem">
              <div>
                <div className="queueTitle">{track.title}</div>
                <div className="queueSub">{track.artist}</div>
              </div>

              {queue.length > 0 && i < queue.length && (
                <button onClick={() => removeFromQueue(i)}>Remove</button>
              )}
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}