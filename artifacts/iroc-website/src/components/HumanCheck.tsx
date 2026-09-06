/**
 * HumanCheck — a lightweight, self-contained arithmetic CAPTCHA.
 *
 * Usage:
 *   const captcha = useHumanCheck();
 *   // render: <HumanCheckWidget {...captcha} />
 *   // gate:   disabled={!captcha.verified}
 *   // reset:  captcha.reset()   ← call after successful submit
 */

import { useState, useCallback } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

// ─── Challenge generator ──────────────────────────────────────────────────────

interface Challenge {
  a: number;
  b: number;
  op: '+' | '-' | '×';
  answer: number;
}

function newChallenge(): Challenge {
  const ops: Array<'+' | '-' | '×'> = ['+', '-', '×'];
  const op = ops[Math.floor(Math.random() * ops.length)];

  let a: number, b: number, answer: number;
  if (op === '+') {
    a = Math.floor(Math.random() * 15) + 2;      // 2–16
    b = Math.floor(Math.random() * 15) + 2;
    answer = a + b;
  } else if (op === '-') {
    a = Math.floor(Math.random() * 12) + 8;      // 8–19
    b = Math.floor(Math.random() * (a - 1)) + 1; // 1…(a-1) → positive result
    answer = a - b;
  } else {
    a = Math.floor(Math.random() * 9) + 2;       // 2–10
    b = Math.floor(Math.random() * 9) + 2;
    answer = a * b;
  }
  return { a, b, op, answer };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface HumanCheckState {
  challenge: Challenge;
  input: string;
  setInput: (v: string) => void;
  verified: boolean;
  reset: () => void;
}

export function useHumanCheck(): HumanCheckState {
  const [challenge, setChallenge] = useState<Challenge>(newChallenge);
  const [input, setInput] = useState('');

  const verified = input.trim() !== '' && parseInt(input, 10) === challenge.answer;

  const reset = useCallback(() => {
    setInput('');
    setChallenge(newChallenge());
  }, []);

  return { challenge, input, setInput, verified, reset };
}

// ─── Widget ───────────────────────────────────────────────────────────────────

export function HumanCheckWidget({ challenge, input, setInput, verified }: HumanCheckState) {
  const { t } = useLanguage();

  const question = `${challenge.a} ${challenge.op} ${challenge.b} = ?`;

  return (
    <div
      className={cn(
        'rounded-xl border-2 p-4 transition-colors',
        verified
          ? 'border-green-400 bg-green-50'
          : 'border-slate-200 bg-slate-50'
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-0.5 p-1.5 rounded-lg shrink-0',
            verified ? 'bg-green-100 text-green-600' : 'bg-slate-200 text-slate-500'
          )}
        >
          <ShieldCheck className="w-4 h-4" />
        </div>

        <div className="flex-1">
          <p className="text-sm font-semibold mb-0.5 text-slate-700">
            {t('Sicherheitscheck', 'Security check')}
          </p>
          <p className="text-xs text-muted-foreground mb-3">
            {t(
              'Bitte lösen Sie diese einfache Rechenaufgabe, um fortzufahren.',
              'Please solve this simple arithmetic problem to continue.'
            )}
          </p>

          <div className="flex items-center gap-3">
            <span className="font-mono text-base font-bold tracking-wide select-none text-slate-800 bg-white border rounded-lg px-3 py-1.5 shadow-sm">
              {question}
            </span>

            <input
              type="number"
              inputMode="numeric"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('Antwort', 'Answer')}
              className={cn(
                'w-24 h-9 rounded-md border px-3 text-sm font-mono text-center',
                'focus:outline-none focus:ring-2 focus:ring-ring',
                input && !verified && 'border-destructive bg-red-50',
                verified && 'border-green-400 bg-green-50 text-green-700 font-bold'
              )}
            />

            {verified && (
              <span className="text-xs font-semibold text-green-600 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                {t('Bestätigt', 'Verified')}
              </span>
            )}
          </div>

          {input && !verified && (
            <p className="text-xs text-destructive mt-1.5">
              {t('Falsche Antwort – bitte erneut versuchen.', 'Wrong answer – please try again.')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
