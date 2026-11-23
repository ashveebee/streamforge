import { useEffect, useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Eye, EyeOff, Globe, LoaderCircle, Lock, User } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api';
import { LogoMark } from '@/components/layout/Logo';
import { Ambient } from '@/components/layout/AppShell';

function Field({ icon: Icon, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { icon: typeof User }) {
  return (
    <label className="group relative block">
      <Icon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-4 transition-colors group-focus-within:text-brand" />
      <input
        {...props}
        className="h-12 w-full rounded-xl border border-line-strong bg-white/[0.03] pr-11 pl-10 text-sm text-ink placeholder:text-ink-4 transition outline-none focus:border-brand/60 focus:bg-white/[0.05] focus:ring-4 focus:ring-brand/10"
      />
    </label>
  );
}

type ServerInfo = { name?: string; version?: string; online: boolean; configured?: boolean };

/** First run: no Jellyfin server is configured yet, so ask for one. */
function Setup({ onDone }: { onDone: (s: ServerInfo) => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      onDone(await api<ServerInfo>('/auth/setup', { method: 'POST', body: { url } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the server address');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="glass rounded-3xl p-6 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.8)] sm:p-7">
      <p className="mb-4 text-sm leading-relaxed text-ink-2">
        First, where is your Jellyfin server? StreamForge will check it's reachable, then you can sign in with your Jellyfin admin account.
      </p>
      <Field
        icon={Globe}
        type="url"
        inputMode="url"
        placeholder="https://jellyfin.example.com"
        autoComplete="url"
        spellCheck={false}
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        aria-label="Jellyfin server address"
        required
      />
      {error && (
        <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} role="alert" className="mt-3 rounded-lg border border-bad/25 bg-bad/10 px-3 py-2 text-xs text-bad">
          {error}
        </motion.p>
      )}
      <button
        type="submit"
        disabled={busy || !url.trim()}
        className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-400 text-sm font-semibold text-white shadow-[0_12px_32px_-12px_rgb(168_85_247/0.8)] transition hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
      >
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <>Connect <ArrowRight className="size-4" /></>}
      </button>
      <p className="mt-4 text-center text-[11px] text-ink-4">You can add Sonarr, Radarr and the rest from Settings once you're in.</p>
    </form>
  );
}

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState<ServerInfo>();
  const needsSetup = server?.configured === false;

  useEffect(() => {
    api<ServerInfo>('/auth/server').then(setServer, () => setServer({ online: false }));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed');
      setBusy(false);
    }
  }

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      <Ambient />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,rgb(139_92_246/0.18),transparent)]" />
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.15] [mask-image:radial-gradient(60%_60%_at_50%_40%,#000,transparent)]"
        style={{ backgroundImage: 'linear-gradient(rgb(255 255 255 / 0.06) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.06) 1px, transparent 1px)', backgroundSize: '56px 56px' }}
      />

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-[400px]"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <motion.div
            initial={{ rotate: -8, scale: 0.8 }}
            animate={{ rotate: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 14, delay: 0.1 }}
            className="relative"
          >
            <div className="absolute inset-0 rounded-2xl bg-brand/40 blur-2xl" />
            <div className="relative"><LogoMark size={56} /></div>
          </motion.div>
          <h1 className="mt-6 text-[28px] font-semibold tracking-tight">Welcome to StreamForge</h1>
          <p className="mt-1.5 text-sm text-ink-3">{needsSetup ? 'Let’s connect your Jellyfin server' : 'Sign in with your Jellyfin account'}</p>
        </div>

        {needsSetup ? (
          <Setup onDone={setServer} />
        ) : (
          <form onSubmit={submit} className="glass rounded-3xl p-6 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.8)] sm:p-7">
            <div className="space-y-3">
              <Field icon={User} placeholder="Username" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} required />
              <div className="relative">
                <Field
                  icon={Lock}
                  type={show ? 'text' : 'password'}
                  placeholder="Password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-ink-4 hover:text-ink-2"
                  aria-label={show ? 'Hide password' : 'Show password'}
                >
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {error && (
              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} role="alert" className="mt-3 rounded-lg border border-bad/25 bg-bad/10 px-3 py-2 text-xs text-bad">
                {error}
              </motion.p>
            )}

            <button
              type="submit"
              disabled={busy || !username}
              className="group relative mt-5 flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-400 text-sm font-semibold text-white shadow-[0_12px_32px_-12px_rgb(168_85_247/0.8)] transition hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
            >
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <>Sign in <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></>}
            </button>

            <div className="mt-5 flex items-center justify-center gap-2 text-xs text-ink-4">
              <span className={`size-1.5 rounded-full ${server === undefined ? 'bg-idle' : server.online ? 'bg-ok shadow-[0_0_8px_var(--color-ok)]' : 'bg-bad'}`} />
              {server === undefined ? 'Contacting server…' : server.online ? `${server.name} · Jellyfin ${server.version}` : 'Jellyfin server unreachable'}
            </div>
          </form>
        )}
        <p className="mt-6 text-center text-[11px] text-ink-4">Credentials are sent directly to your Jellyfin server and never stored.</p>
      </motion.div>
    </div>
  );
}
