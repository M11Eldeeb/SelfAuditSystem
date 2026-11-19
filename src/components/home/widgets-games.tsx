"use client";

// Small games for a short break. Every game starts on a click, so nothing random is drawn on the server.
import { useEffect, useRef, useState } from "react";
import type { WidgetProps } from "@/components/home/widgets-tools";

const btn = "rounded-full bg-neutral-900 px-3.5 py-1.5 text-[13px] font-semibold text-white transition active:scale-95 disabled:opacity-40";
const input = "h-9 min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-2.5 text-[14px] text-neutral-900 focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none";
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- tic-tac-toe -----------------------------------------------------------------------------------------------------------

type Cell = "X" | "O" | null;
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const winner = (b: Cell[]) => {
  for (const [a, c, d] of LINES) if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  return b.every(Boolean) ? "draw" : null;
};
/** The computer: win if it can, block if it must, else the centre, a corner, anything. */
function computerMove(b: Cell[]): number {
  const free = b.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
  for (const who of ["O", "X"] as const) {
    for (const i of free) {
      const t = [...b];
      t[i] = who;
      if (winner(t) === who) return i;
    }
  }
  if (b[4] === null) return 4;
  const corners = [0, 2, 6, 8].filter((i) => b[i] === null);
  const pool = corners.length ? corners : free;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function TicTacToeWidget({ data, update }: WidgetProps) {
  const [board, setBoard] = useState<Cell[]>(Array(9).fill(null));
  const result = winner(board);
  const score = { w: num(data.w), l: num(data.l), d: num(data.d) };
  const play = (i: number) => {
    if (board[i] || result) return;
    const b = [...board];
    b[i] = "X";
    if (!winner(b)) b[computerMove(b)] = "O";
    setBoard(b);
    const r = winner(b);
    if (r) update(r === "X" ? { w: score.w + 1 } : r === "O" ? { l: score.l + 1 } : { d: score.d + 1 });
  };
  return (
    <div className="flex flex-col items-center">
      <div className="grid grid-cols-3 gap-1.5">
        {board.map((c, i) => (
          <button key={i} type="button" onClick={() => play(i)} aria-label={`Square ${i + 1}${c ? `, ${c}` : ""}`} className="flex h-14 w-14 items-center justify-center rounded-xl bg-neutral-900/[0.05] text-[24px] font-bold transition hover:bg-neutral-900/[0.08]">
            <span className={c === "X" ? "text-brand" : "text-neutral-700"}>{c}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-[14px] font-semibold text-neutral-800" aria-live="polite">
        {result === "X" ? "You win!" : result === "O" ? "The computer wins this one." : result === "draw" ? "A draw." : "You are X."}
      </p>
      <p className="text-[12px] text-neutral-500">
        Won {score.w} · Lost {score.l} · Draw {score.d}
      </p>
      {result && (
        <button type="button" onClick={() => setBoard(Array(9).fill(null))} className={`${btn} mt-2`}>
          Play again
        </button>
      )}
    </div>
  );
}

// ---- memory match ----------------------------------------------------------------------------------------------------------

const SYMBOLS = ["MG", "ZS", "HS", "RX5", "GT", "MG4", "MG5", "RX8"];
type Card = { id: number; symbol: string; found: boolean };

export function MemoryWidget({ data, update }: WidgetProps) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [open, setOpen] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const best = num(data.best);
  const start = () => {
    setCards(shuffle([...SYMBOLS, ...SYMBOLS]).map((symbol, id) => ({ id, symbol, found: false })));
    setOpen([]);
    setMoves(0);
  };
  const flip = (i: number) => {
    if (!cards || open.length === 2 || open.includes(i) || cards[i].found) return;
    const next = [...open, i];
    setOpen(next);
    if (next.length < 2) return;
    const m = moves + 1;
    setMoves(m);
    const [a, b] = next;
    if (cards[a].symbol === cards[b].symbol) {
      const done = cards.map((c, k) => (k === a || k === b ? { ...c, found: true } : c));
      setCards(done);
      setOpen([]);
      if (done.every((c) => c.found) && (!best || m < best)) update({ best: m });
    } else setTimeout(() => setOpen([]), 700);
  };
  if (!cards)
    return (
      <div className="flex flex-col items-center py-4">
        <p className="text-[14px] text-neutral-600">{best ? `Your best: ${best} moves.` : "Eight pairs of MG models."}</p>
        <button type="button" onClick={start} className={`${btn} mt-3`}>
          Start
        </button>
      </div>
    );
  const finished = cards.every((c) => c.found);
  return (
    <div className="flex flex-col items-center">
      <div className="grid grid-cols-4 gap-1.5">
        {cards.map((c, i) => {
          const shown = c.found || open.includes(i);
          return (
            <button key={c.id} type="button" onClick={() => flip(i)} aria-label={shown ? c.symbol : "Hidden card"} className={`flex h-12 w-14 items-center justify-center rounded-xl text-[13px] font-bold transition ${shown ? (c.found ? "bg-emerald-600/15 text-emerald-800" : "bg-white text-neutral-900 ring-1 ring-neutral-300") : "bg-brand text-white hover:opacity-90"}`}>
              {shown ? c.symbol : "?"}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[13px] text-neutral-600" aria-live="polite">
        {finished ? `All pairs in ${moves} moves!${best && moves <= best ? " A new best." : ""}` : `${moves} moves${best ? ` · best ${best}` : ""}`}
      </p>
      {finished && (
        <button type="button" onClick={start} className={`${btn} mt-2`}>
          Play again
        </button>
      )}
    </div>
  );
}

// ---- guess the number ------------------------------------------------------------------------------------------------------

export function GuessWidget({ data, update }: WidgetProps) {
  const [secret, setSecret] = useState<number | null>(null);
  const [tries, setTries] = useState(0);
  const [hint, setHint] = useState("");
  const [value, setValue] = useState("");
  const best = num(data.best);
  const start = () => {
    setSecret(1 + Math.floor(Math.random() * 100));
    setTries(0);
    setHint("I picked a number from 1 to 100.");
    setValue("");
  };
  const won = hint.startsWith("Yes");
  return (
    <div>
      {secret === null ? (
        <div className="flex flex-col items-center py-4">
          <p className="text-[14px] text-neutral-600">{best ? `Your best: ${best} tries.` : "Can you find it in 7 tries?"}</p>
          <button type="button" onClick={start} className={`${btn} mt-3`}>
            Start
          </button>
        </div>
      ) : (
        <>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const g = Number(value);
              if (!Number.isInteger(g) || g < 1 || g > 100 || won) return;
              const t = tries + 1;
              setTries(t);
              setValue("");
              if (g === secret) {
                setHint(`Yes! ${secret} in ${t} tries.`);
                if (!best || t < best) update({ best: t });
              } else setHint(g < secret ? `Higher than ${g}.` : `Lower than ${g}.`);
            }}
          >
            <input value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" placeholder="1 - 100" aria-label="Your guess" disabled={won} className={input} />
            <button type="submit" className={btn} disabled={won || !value}>
              Guess
            </button>
          </form>
          <p className={`mt-3 text-[15px] font-semibold ${won ? "text-emerald-700" : "text-neutral-800"}`} aria-live="polite">
            {hint}
          </p>
          <p className="text-[12px] text-neutral-500">
            {tries} tries{best ? ` · best ${best}` : ""}
          </p>
          {won && (
            <button type="button" onClick={start} className={`${btn} mt-2`}>
              Play again
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ---- reaction test ---------------------------------------------------------------------------------------------------------

export function ReactionWidget({ data, update }: WidgetProps) {
  const [state, setState] = useState<"idle" | "wait" | "go" | "early" | "done">("idle");
  const [ms, setMs] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownAt = useRef(0);
  const best = num(data.best);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const click = () => {
    if (state === "idle" || state === "done" || state === "early") {
      setState("wait");
      timer.current = setTimeout(() => {
        shownAt.current = performance.now();
        setState("go");
      }, 1500 + Math.random() * 2500);
    } else if (state === "wait") {
      if (timer.current) clearTimeout(timer.current);
      setState("early");
    } else {
      const t = Math.round(performance.now() - shownAt.current);
      setMs(t);
      setState("done");
      if (!best || t < best) update({ best: t });
    }
  };
  const look = {
    idle: ["bg-neutral-900/[0.05] text-neutral-800", "Click to start"],
    wait: ["bg-red-600 text-white", "Wait for green…"],
    go: ["bg-emerald-600 text-white", "Click!"],
    early: ["bg-amber-400 text-neutral-900", "Too soon! Click to try again"],
    done: ["bg-neutral-900/[0.05] text-neutral-800", `${ms} ms - click to go again`],
  }[state];
  return (
    <div>
      <button type="button" onMouseDown={click} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), click())} className={`flex h-32 w-full items-center justify-center rounded-2xl text-[17px] font-bold transition-colors select-none ${look[0]}`}>
        {look[1]}
      </button>
      <p className="mt-2 text-[12px] text-neutral-500">{best ? `Your best: ${best} ms` : "Most people react in about 250 ms."}</p>
    </div>
  );
}

// ---- word scramble ---------------------------------------------------------------------------------------------------------

const WORDS = ["BRAKE", "ENGINE", "GEARBOX", "BATTERY", "CLUTCH", "PISTON", "RADIATOR", "BUMPER", "WARRANTY", "CHASSIS", "SENSOR", "TURBO", "AXLE", "MUFFLER", "ALTERNATOR", "GASKET", "INJECTOR", "SPARKPLUG", "COOLANT", "WORKSHOP", "MILEAGE", "STEERING", "BEARING", "THROTTLE"];

export function ScrambleWidget({ data, update }: WidgetProps) {
  const [word, setWord] = useState<string | null>(null);
  const [mixed, setMixed] = useState("");
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState("");
  const [streak, setStreak] = useState(0);
  const best = num(data.best);
  const next = () => {
    const w = WORDS[Math.floor(Math.random() * WORDS.length)];
    let m = w;
    while (m === w) m = shuffle(w.split("")).join("");
    setWord(w);
    setMixed(m);
    setValue("");
    setMsg("");
  };
  if (!word)
    return (
      <div className="flex flex-col items-center py-4">
        <p className="text-[14px] text-neutral-600">{best ? `Best streak: ${best}.` : "Workshop words, letters mixed up."}</p>
        <button type="button" onClick={next} className={`${btn} mt-3`}>
          Start
        </button>
      </div>
    );
  return (
    <div>
      <p className="text-center text-[26px] font-bold tracking-[0.25em] text-neutral-900">{mixed}</p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim().toUpperCase() === word) {
            const s = streak + 1;
            setStreak(s);
            if (s > best) update({ best: s });
            next();
            setMsg("Correct! Here is the next one.");
          } else setMsg("Not quite - try again.");
        }}
      >
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Your answer" aria-label="Your answer" className={input} />
        <button type="submit" className={btn} disabled={!value.trim()}>
          Check
        </button>
      </form>
      <p className="mt-2 text-[13px] text-neutral-700" aria-live="polite">
        {msg}
      </p>
      <div className="mt-1 flex items-center justify-between text-[12px] text-neutral-500">
        <span>
          Streak {streak}
          {best ? ` · best ${best}` : ""}
        </span>
        <button
          type="button"
          onClick={() => {
            setMsg(`It was ${word}.`);
            setStreak(0);
            const w = word;
            next();
            setMsg(`It was ${w}.`);
          }}
          className="font-semibold text-neutral-600 hover:text-neutral-900"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
