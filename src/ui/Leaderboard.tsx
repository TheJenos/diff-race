import { useEffect, useState } from 'react';
import { isConfigured } from '../net/firebase';
import { browserProfileId, watchLeaderboard } from '../net/leaderboard';
import type { BoardRecord } from '../net/records';
import { friendlyError } from './errors';

const MEDALS = ['🥇', '🥈', '🥉'];

/** The global top 20 (room races only): a podium for the first three, then the table */
export function Leaderboard() {
  const [rows, setRows] = useState<(BoardRecord & { id: string })[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isConfigured) return;
    return watchLeaderboard(20, setRows, (e) => setError(friendlyError(e)));
  }, []);
  const me = browserProfileId();
  // The podium in its usual order: second, first, third.
  const podium = rows ? [1, 0, 2].map((i) => (rows[i] ? { ...rows[i], place: i + 1 } : null)).filter(Boolean) : [];
  return (
    <div id="leaderboard" className="leaderboard">
      <div className="board-head"><h2>Leaderboard</h2><span className="muted">Room races · 5 a race, 20 a podium, 50 a win, 10 a kill</span></div>
      {!isConfigured && <p className="empty">Leaderboards need a database (see the README).</p>}
      {error && <p className="error">{error}</p>}
      {isConfigured && !rows && !error && <p className="empty"><span className="spinner" aria-hidden="true" />Loading…</p>}
      {rows && rows.length === 0 && <p className="empty">Nobody yet. Win a room race to be first.</p>}
      {rows && rows.length > 0 && (
        <>
          <ol className="podium-board" aria-label="Top three">
            {podium.map((r) => r && (
              <li key={r.id} className={`place-${r.place}${r.id === me ? ' me' : ''}`}>
                <span className="medal" aria-hidden="true">{MEDALS[r.place - 1]}</span>
                <span className="who">{r.name}</span>
                <span className="pts">{r.score} <small>pts</small></span>
                <span className="plinth">{r.place}</span>
              </li>
            ))}
          </ol>
          <table>
            <thead><tr><th>#</th><th className="name">Driver</th><th>Score</th><th>Wins</th><th>Podiums</th><th>Kills</th><th>Races</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className={r.id === me ? 'me' : ''}>
                  <td className="rank">{i + 1}</td>
                  <td className="name">{r.name}{r.id === me && <span className="you"> (you)</span>}</td>
                  <td className="score">{r.score}</td><td>{r.wins}</td><td>{r.podiums}</td><td>{r.kills}</td><td>{r.races}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
