import { useEffect, useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Eye, EyeOff, Globe, KeyRound, LoaderCircle, Lock, Radar, Server, ShieldCheck, User } from 'lucide-react';
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

type ServerInfo = { name?: string; version?: string; online: boolean; configured?: boolean; sso?: { label: string; hidePassword: boolean } };

type Found = { id: string; name: string; url: string; version?: string; reachable: boolean };

/** First run: no Jellyfin server is configured yet, so ask for one (or find it on the network). */
function Setup({ onDone }: { onDone: (s: ServerInfo) => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Found[]>();
  const [searching, setSearching] = useState(false);

  async function search() {
    setSearching(true);
    setError(undefined);
    try {
      const r = await api<{ servers: Found[] }>('/auth/setup/discover', { method: 'POST' });
      setFound(r.servers);
      // One server that answers: fill it in, ready to connect.
      const ok = r.servers.filter((s) => s.reachable);
      if (ok.length === 1 && !url.trim()) setUrl(ok[0]!.url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not search the network');
    } finally {
      setSearching(false);
    }
  }

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
      {found === undefined ? (
        <button
          type="button"
          onClick={() => void search()}
          disabled={searching}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-ink-3 transition hover:text-ink disabled:opacity-60"
        >
          {searching ? <LoaderCircle className="size-3.5 animate-spin" /> : <Radar className="size-3.5" />}
          {searching ? 'Searching your network…' : 'Find servers on my network'}
        </button>
      ) : found.length === 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-ink-4">
          No servers answered. Discovery only works on the same local network, and from Docker only with host networking. Type the address instead.{' '}
          <button type="button" onClick={() => void search()} disabled={searching} className="font-medium text-ink-3 underline-offset-2 hover:text-ink hover:underline">
            {searching ? 'Searching…' : 'Search again'}
          </button>
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5" aria-label="Servers found on your network">
          {found.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setUrl(s.url)}
                aria-pressed={url === s.url}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${url === s.url ? 'border-brand/50 bg-brand/10' : 'border-line bg-white/[0.02] hover:bg-white/[0.05]'}`}
              >
                <Server className="size-4 shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{s.name}</span>
                  <span className="block truncate font-mono text-[11px] text-ink-3">{s.url}</span>
                </span>
                <span className="shrink-0 text-[11px] text-ink-4">{s.reachable ? (s.version ? `v${s.version}` : '') : 'Not answering'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
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
      <p className="mt-4 text-center text-[11px] leading-relaxed text-ink-4">
        Sign-in uses Jellyfin. Once you're in, add Emby and Plex servers, Sonarr, Radarr and the rest from Settings.
      </p>
    </form>
  );
}

/** Second step: a code from the user's authenticator app (or a recovery code). */
function MfaStep({ challenge, onBack }: { challenge: string; onBack: (msg?: string) => void }) {
  const { verifyMfa } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await verifyMfa(challenge, code);
    } catch (err) {
      const e2 = err as ApiError;
      if (e2.code === 'expired') return onBack(e2.message);
      setError(e2 instanceof ApiError ? e2.message : 'Sign-in failed');
      setCode('');
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="glass rounded-3xl p-6 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.8)] sm:p-7">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium text-ink"><ShieldCheck className="size-4 text-brand" /> Two-factor sign-in</div>
      <p className="mb-4 text-xs leading-relaxed text-ink-3">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
      <Field
        icon={KeyRound}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        autoFocus
        value={code}
        onChange={(e) => setCode(e.target.value)}
        aria-label="Verification code"
        maxLength={20}
        required
      />
      {error && (
        <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} role="alert" className="mt-3 rounded-lg border border-bad/25 bg-bad/10 px-3 py-2 text-xs text-bad">
          {error}
        </motion.p>
      )}
      <button
        type="submit"
        disabled={busy || code.trim().length < 6}
        className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-400 text-sm font-semibold text-white shadow-[0_12px_32px_-12px_rgb(168_85_247/0.8)] transition hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
      >
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <>Verify <ArrowRight className="size-4" /></>}
      </button>
      <button type="button" onClick={() => onBack()} className="mt-3 w-full text-center text-xs text-ink-4 hover:text-ink-2">Use a different account</button>
    </form>
  );
}

export default function Login() {
  const { login } = useAuth();
  const [challenge, setChallenge] = useState<string>();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState<ServerInfo>();
  const needsSetup = server?.configured === false;
  // ?password forces the password form, in case single sign-on is broken.
  const hidePassword = !!server?.sso?.hidePassword && !new URLSearchParams(location.search).has('password');

  useEffect(() => {
    api<ServerInfo>('/auth/server').then(setServer, () => setServer({ online: false }));
    // Single sign-on reports problems back through the URL.
    const err = new URLSearchParams(location.search).get('error');
    if (err) {
      setError(err.slice(0, 300));
      history.replaceState(null, '', '/login');
    }
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const r = await login(username, password);
      if (r.mfaChallenge) {
        setChallenge(r.mfaChallenge);
        setPassword('');
        setBusy(false);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed');
      setBusy(false);
    }
  }

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4 pt-[calc(2.5rem+env(safe-area-inset-top))] pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
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
        ) : challenge ? (
          <MfaStep
            challenge={challenge}
            onBack={(msg) => {
              setChallenge(undefined);
              setError(msg);
            }}
          />
        ) : (
          <form onSubmit={submit} className="glass rounded-3xl p-6 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.8)] sm:p-7">
            {server?.sso && (
              <>
                <a
                  href="/api/auth/oidc/start"
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-line-strong bg-white/[0.04] text-sm font-semibold text-ink transition hover:bg-white/[0.08]"
                >
                  <ShieldCheck className="size-4 text-brand" /> Sign in with {server.sso.label}
                </a>
                {!hidePassword && (
                  <div className="my-4 flex items-center gap-3 text-[11px] text-ink-4">
                    <span className="h-px flex-1 bg-line" /> or use your Jellyfin password <span className="h-px flex-1 bg-line" />
                  </div>
                )}
                {hidePassword && error && (
                  <p role="alert" className="mt-3 rounded-lg border border-bad/25 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</p>
                )}
              </>
            )}
            {!hidePassword && <>
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
            </>}

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
