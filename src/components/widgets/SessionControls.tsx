import { useState, type FormEvent } from 'react';
import { LoaderCircle, MessageSquare, Pause, Play, Square } from 'lucide-react';
import { useSessionControl } from '@/hooks/queries';
import { useAuth } from '@/hooks/useAuth';
import type { NowPlaying } from '@/lib/types';
import { Button } from '@/components/ui/Button';

/** Pause/resume, message or stop a stream (admins only). */
export function SessionControls({ s }: { s: NowPlaying }) {
  const { user } = useAuth();
  const control = useSessionControl();
  const [mode, setMode] = useState<'message' | 'stop'>();
  const [text, setText] = useState('');
  if (!user?.isAdmin) return null;
  const busy = control.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    control.mutate(
      { id: s.sessionId, command: mode!, text: text.trim() || undefined },
      {
        onSuccess: () => {
          setMode(undefined);
          setText('');
        },
      },
    );
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => control.mutate({ id: s.sessionId, command: s.state.isPaused ? 'unpause' : 'pause' })}>
          {s.state.isPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          {s.state.isPaused ? 'Resume' : 'Pause'}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} aria-pressed={mode === 'message'} onClick={() => setMode(mode === 'message' ? undefined : 'message')}>
          <MessageSquare className="size-3.5" /> Message
        </Button>
        <Button size="sm" variant="ghost" className="hover:text-bad" disabled={busy} aria-pressed={mode === 'stop'} onClick={() => setMode(mode === 'stop' ? undefined : 'stop')}>
          <Square className="size-3.5" /> Stop
        </Button>
        {busy && <LoaderCircle className="size-3.5 animate-spin text-ink-4" />}
        {control.error && <span className="text-[11px] text-bad">{(control.error as Error).message}</span>}
      </div>
      {mode && (
        <form onSubmit={submit} className="mt-2 flex gap-2">
          <input
            autoFocus
            maxLength={500}
            className="h-8 min-w-0 flex-1 rounded-lg border border-line-strong bg-white/[0.03] px-2.5 text-xs text-ink outline-none placeholder:text-ink-4 focus:border-brand/60"
            placeholder={mode === 'message' ? `Message to ${s.user.name}…` : 'Optional reason shown before it stops'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit" size="sm" variant={mode === 'stop' ? 'outline' : 'primary'} className={mode === 'stop' ? 'border-bad/40 text-bad' : undefined} disabled={busy || (mode === 'message' && !text.trim())}>
            {mode === 'message' ? 'Send' : 'Stop playback'}
          </Button>
        </form>
      )}
    </div>
  );
}
