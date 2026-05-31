import React, { useEffect, useState } from 'react';

export interface SpotifyDebugEvent {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  details?: Record<string, any>;
}

export function SpotifyDebugPanel() {
  const [events, setEvents] = useState<SpotifyDebugEvent[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleDebugEvent = (_: unknown, event: SpotifyDebugEvent) => {
      setEvents((prev) => {
        const updated = [...prev, event];
        // Keep last 100 events
        return updated.length > 100 ? updated.slice(-100) : updated;
      });
    };

    window.api?.debugEvents?.onSpotifyDebug?.(handleDebugEvent);

    return () => {
      window.api?.debugEvents?.removeOnSpotifyDebug?.(handleDebugEvent);
    };
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  if (!isVisible) {
    return (
      <button
        onClick={() => setIsVisible(true)}
        className="fixed bottom-4 right-4 z-50 px-3 py-2 text-xs font-mono bg-slate-900 text-slate-300 border border-slate-700 rounded hover:bg-slate-800 transition-colors"
        title="Show Spotify debug info"
      >
        {events.length > 0 && <span className="inline-block w-2 h-2 bg-amber-400 rounded-full mr-2" />}
        Debug
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-96 h-80 bg-slate-950 border border-slate-700 rounded-lg shadow-lg flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
        <h3 className="text-xs font-mono font-semibold text-slate-300">Spotify Debug</h3>
        <div className="flex gap-2">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="w-3 h-3 cursor-pointer"
            />
            <span className="text-slate-400">Auto-scroll</span>
          </label>
          <button
            onClick={() => setEvents([])}
            className="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors"
          >
            Clear
          </button>
          <button
            onClick={() => setIsVisible(false)}
            className="text-xs px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      {/* Events list */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-1 font-mono text-xs"
      >
        {events.length === 0 ? (
          <p className="text-slate-500">Waiting for Spotify events…</p>
        ) : (
          events.map((event, i) => (
            <div
              key={i}
              className={`flex gap-2 ${
                event.level === 'error'
                  ? 'text-red-400'
                  : event.level === 'warn'
                    ? 'text-yellow-400'
                    : event.level === 'debug'
                      ? 'text-slate-500'
                      : 'text-green-400'
              }`}
            >
              <span className="text-slate-600 shrink-0">
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
              <span className="text-slate-500 shrink-0">
                [{event.level.toUpperCase()}]
              </span>
              <span className="break-words">{event.message}</span>
              {event.details && (
                <span className="text-slate-600 break-words">
                  {JSON.stringify(event.details).slice(0, 80)}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
