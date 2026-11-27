import { useEffect, useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Clapperboard, MonitorPlay, Eye, EyeOff, Globe, KeyRound, LoaderCircle, Lock, Projector, Radar, Server, ShieldCheck, User } from 'lucide-react';
import type { User as AppUser } from '@/lib/types';
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

type ServerInfo = { type?: 'jellyfin' | 'plex' | 'emby'; name?: string; version?: string; online: boolean; configured?: boolean; sso?: { label: string; hidePassword: boolean } };

type PlexResult = { pending?: boolean; servers?: { id: string; name: string; version?: string }[]; user?: AppUser; mfaRequired?: boolean; challenge?: string };

/**
 * "Sign in with Plex": opens Plex's own sign-in page in a window and waits
 * until it's approved. Plex never shares the password with StreamForge.
 */
function usePlexSignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [handle, setHandle] = useState<string>();

  async function start(): Promise<PlexResult | undefined> {
    setBusy(true);
    setError(undefined);
    // Open the window straight away, inside the click, so pop-up blockers allow it.
    const popup = window.open('about:blank', 'plex-sign-in', 'width=600,height=720');
    try {
      const { handle: h, authUrl } = await api<{ handle: string; authUrl: string }>('/auth/plex/start', { method: 'POST' });
      setHandle(h);
      if (popup) popup.location.href = authUrl;
      else window.open(authUrl, '_blank', 'noopener');
      // Plex approves within seconds; give up after ten minutes, or soon after the window closes.
      let closedFor = 0;
      for (let i = 0; i < 400; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const r = await api<PlexResult>('/auth/plex/poll', { method: 'POST', body: { handle: h } });
        if (!r.pending) {
          popup?.close();
          setBusy(false);
          return { ...r, pending: false };
        }
        if (popup?.closed && ++closedFor > 3) throw new Error('The Plex window was closed before you finished signing in.');
      }
      throw new Error('Sign-in timed out. Try again.');
    } catch (err) {
      popup?.close();
      setError(err instanceof Error ? err.message : 'Could not sign in with Plex');
      setBusy(false);
      return undefined;
    }
  }
  return { start, busy, error, setError, handle };
}

/** The Plex-branded button. */
function PlexButton({ busy, onClick, label = 'Sign in with Plex' }: { busy: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#e5a00d] text-sm font-semibold text-black shadow-[0_12px_32px_-12px_rgb(229_160_13/0.8)] transition hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
    >
      {busy ? (
        <>
          <LoaderCircle className="size-4 animate-spin" /> Waiting for Plex…
        </>
      ) : (
        <>
          <Projector className="size-4" /> {label}
        </>
      )}
    </button>
  );
}

const ErrorNote = ({ children }: { children: React.ReactNode }) => (
  <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} role="alert" className="mt-3 rounded-lg border border-bad/25 bg-bad/10 px-3 py-2 text-xs text-bad">
    {children}
  </motion.p>
);

/** First run, Plex: sign in with the owner's Plex account, then pick which of their servers to use. */
function PlexSetup({ onBack }: { onBack: () => void }) {
  const { signedIn } = useAuth();
  const plex = usePlexSignIn();
  const [servers, setServers] = useState<PlexResult['servers']>();
  const [saving, setSaving] = useState<string>();
  const [error, setError] = useState<string>();

  async function use(id: string) {
    setSaving(id);
    setError(undefined);
    try {
      const r = await api<PlexResult>('/auth/plex/setup', { method: 'POST', body: { handle: plex.handle, server: id } });
      if (r.user) signedIn(r.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not connect to that server');
      setSaving(undefined);
    }
  }

  async function signIn() {
    const r = await plex.start();
    if (!r?.servers) return;
    setServers(r.servers);
  }

  return (
    <div className="glass rounded-3xl p-6 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.8)] sm:p-7">
      {!servers ? (
        <>
          <p className="mb-4 text-sm leading-relaxed text-ink-2">
            Sign in with the Plex account that owns your server. StreamForge finds your servers, and everyone you share with can then sign in with their own Plex account.
          </p>
          <PlexButton busy={plex.busy} onClick={() => void signIn()} />
          {plex.error && <ErrorNote>{plex.error}</ErrorNote>}
        </>
      ) : servers.length === 0 ? (
        <>
          <p className="text-sm leading-relaxed text-ink-2">This Plex account doesn’t own any servers. Sign in with the account that runs your Plex server.</p>
          <div className="mt-4">
            <PlexButton busy={plex.busy} onClick={() => void signIn()} label="Use a different Plex account" />
          </div>
        </>
      ) : (
        <>
          <p className="mb-3 text-sm leading-relaxed text-ink-2">Which server should StreamForge use?</p>
          <ul className="space-y-1.5" aria-label="Your Plex servers">
            {servers.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => void use(s.id)}
                  disabled={!!saving}
                  className="flex w-full items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2.5 text-left transition hover:bg-white/[0.05] disabled:opacity-60"
                >
                  <Server className="size-4 shrink-0 text-[#e5a00d]" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{s.name}</span>
                  <span className="shrink-0 text-[11px] text-ink-4">{saving === s.id ? <LoaderCircle className="size-3.5 animate-spin" /> : s.version ? `v${s.version}` : ''}</span>
                </button>
              </li>
            ))}
          </ul>
          {error && <ErrorNote>{error}</ErrorNote>}
        </>
      )}
      <button type="button" onClick={onBack} className="mt-4 w-full text-center text-xs text-ink-4 hover:text-ink-2">
        Choose a different server
      </button>
    </div>
  );
}

/** First run: which media server do people sign in with? */
type SetupType = 'jellyfin' | 'plex' | 'emby';

/** First run, Emby: the server's address and an administrator's sign-in, in one step. */
function EmbySetup({ onBack }: { onBack: () => void }) {
  const { signedIn } = useAuth();
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Found[]>();
  const [searching, setSearching] = useState(false);

  async function search() {
    setSearching(true);
    setError(undefined);
    try {
      const r = await api<{ servers: Found[] }>('/auth/setup/discover?type=emby', { method: 'POST' });
      setFound(r.servers);
      const ok = r.servers.filter((x) => x.reachable);
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
      const r = await api<{ user: AppUser }>('/auth/emby/setup', { method: 'POST', body: { url, username, password } });
      signedIn(r.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not connect to Emby');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="glass rounded-3xl p-6 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.8)] sm:p-7">
      <p className="mb-4 text-sm leading-relaxed text-ink-2">
        Where is your Emby server? Sign in with an Emby administrator account: StreamForge checks the server, creates its own API key, and everyone else signs in with
        their Emby account.
      </p>
      <Field icon={Globe} type="url" inputMode="url" placeholder="http://192.168.1.20:8096" autoComplete="url" spellCheck={false} autoFocus value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Emby server address" required />
      {found === undefined ? (
        <button type="button" onClick={() => void search()} disabled={searching} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-ink-3 transition hover:text-ink disabled:opacity-60">
          {searching ? <LoaderCircle className="size-3.5 animate-spin" /> : <Radar className="size-3.5" />}
          {searching ? 'Searching your network…' : 'Find Emby servers on my network'}
        </button>
      ) : found.length === 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-ink-4">No Emby servers answered. Discovery only works on the same local network, and from Docker only with host networking. Type the address instead.</p>
      ) : (
        <ul className="mt-3 space-y-1.5" aria-label="Emby servers found on your network">
          {found.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => setUrl(x.url)}
                aria-pressed={url === x.url}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${url === x.url ? 'border-brand/50 bg-brand/10' : 'border-line bg-white/[0.02] hover:bg-white/[0.05]'}`}
              >
                <Server className="size-4 shrink-0 text-[#52b54b]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{x.name}</span>
                  <span className="block truncate font-mono text-[11px] text-ink-3">{x.url}</span>
                </span>
                <span className="shrink-0 text-[11px] text-ink-4">{x.version ? `v${x.version}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 space-y-3">
        <Field icon={User} placeholder="Emby admin username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <Field icon={Lock} type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <button
        type="submit"
        disabled={busy || !url.trim() || !username.trim()}
        className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#52b54b] text-sm font-semibold text-white shadow-[0_12px_32px_-12px_rgb(82_181_75/0.8)] transition hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
      >
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <>Connect and sign in <ArrowRight className="size-4" /></>}
      </button>
      <button type="button" onClick={onBack} className="mt-4 w-full text-center text-xs text-ink-4 hover:text-ink-2">
        Choose a different server
      </button>
    </form>
  );
}

function ChooseServer({ onPick }: { onPick: (t: SetupType) => void }) {
  const card = 'flex w-full items-center gap-3 rounded-2xl border border-line bg-white/[0.02] p-4 text-left transition hover:border-line-strong hover:bg-white/[0.05]';
  return (
    <div className="glass rounded-3xl p-6 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.8)] sm:p-7">
      <p className="mb-1 text-[11px] font-semibold tracking-[0.1em] text-ink-4 uppercase">Step 1 of 2 · Media server</p>
      <p className="mb-4 text-sm leading-relaxed text-ink-2">Which media server do you use? People will sign in to StreamForge with their account on it.</p>
      <div className="space-y-2.5">
        <button type="button" className={card} onClick={() => onPick('plex')}>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e5a00d]/15"><Projector className="size-5 text-[#e5a00d]" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">Plex</span>
            <span className="block text-xs text-ink-3">Sign in with your Plex account</span>
          </span>
          <ArrowRight className="size-4 text-ink-4" />
        </button>
        <button type="button" className={card} onClick={() => onPick('jellyfin')}>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#aa5cc3]/15"><Clapperboard className="size-5 text-[#aa5cc3]" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">Jellyfin</span>
            <span className="block text-xs text-ink-3">Sign in with your Jellyfin account</span>
          </span>
          <ArrowRight className="size-4 text-ink-4" />
        </button>
        <button type="button" className={card} onClick={() => onPick('emby')}>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#52b54b]/15"><MonitorPlay className="size-5 text-[#52b54b]" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">Emby</span>
            <span className="block text-xs text-ink-3">Sign in with your Emby account</span>
          </span>
          <ArrowRight className="size-4 text-ink-4" />
        </button>
      </div>
      <p className="mt-4 text-center text-[11px] leading-relaxed text-ink-4">
        StreamForge watches the one you choose. Next, it finds Sonarr, Radarr, Seerr and your other apps.
      </p>
    </div>
  );
}

/** Plex sign-in, once Plex is the sign-in server. */
function PlexLogin({ server, initialError, onChallenge }: { server?: ServerInfo; initialError?: string; onChallenge: (c: string) => void }) {
  const { signedIn } = useAuth();
  const plex = usePlexSignIn();
  async function signIn() {
    const r = await plex.start();
    if (r?.mfaRequired && r.challenge) onChallenge(r.challenge);
    else if (r?.user) signedIn(r.user);
  }
  return (
    <div className="glass rounded-3xl p-6 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.8)] sm:p-7">
      <PlexButton busy={plex.busy} onClick={() => void signIn()} />
      {(plex.error ?? initialError) && <ErrorNote>{plex.error ?? initialError}</ErrorNote>}
      <div className="mt-5 flex items-center justify-center gap-2 text-xs text-ink-4">
        <span className={`size-1.5 rounded-full ${server === undefined ? 'bg-idle' : server.online ? 'bg-ok shadow-[0_0_8px_var(--color-ok)]' : 'bg-bad'}`} />
        {server === undefined ? 'Contacting server…' : server.online ? `${server.name} · Plex ${server.version ?? ''}` : 'Plex server unreachable'}
      </div>
    </div>
  );
}

type Found = { id: string; name: string; url: string; version?: string; reachable: boolean };

/** First run: no Jellyfin server is configured yet, so ask for one (or find it on the network). */
function Setup({ onDone, onBack }: { onDone: (s: ServerInfo) => void; onBack: () => void }) {
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
      <p className="mt-4 text-center text-[11px] leading-relaxed text-ink-4">Once you're in, add Emby and Plex servers, Sonarr, Radarr and the rest from Settings.</p>
      <button type="button" onClick={onBack} className="mt-3 w-full text-center text-xs text-ink-4 hover:text-ink-2">
        Choose a different server
      </button>
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
  const [setupType, setSetupType] = useState<SetupType>();
  const needsSetup = server?.configured === false;
  const plexSignIn = server?.type === 'plex';
  // Jellyfin and Emby both sign in with a name and password.
  const pwName = server?.type === 'emby' ? 'Emby' : 'Jellyfin';
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
          <p className="mt-1.5 text-sm text-ink-3">
            {needsSetup
              ? setupType
                ? `Let’s connect your ${{ plex: 'Plex', jellyfin: 'Jellyfin', emby: 'Emby' }[setupType]} server`
                : 'Let’s connect your media server'
              : plexSignIn
                ? 'Sign in with your Plex account'
                : `Sign in with your ${pwName} account`}
          </p>
        </div>

        {needsSetup && !challenge ? (
          setupType === 'plex' ? (
            <PlexSetup onBack={() => setSetupType(undefined)} />
          ) : setupType === 'emby' ? (
            <EmbySetup onBack={() => setSetupType(undefined)} />
          ) : setupType === 'jellyfin' ? (
            <Setup onDone={setServer} onBack={() => setSetupType(undefined)} />
          ) : (
            <ChooseServer onPick={setSetupType} />
          )
        ) : challenge ? (
          <MfaStep
            challenge={challenge}
            onBack={(msg) => {
              setChallenge(undefined);
              setError(msg);
            }}
          />
        ) : plexSignIn ? (
          <PlexLogin server={server} initialError={error} onChallenge={setChallenge} />
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
              {server === undefined ? 'Contacting server…' : server.online ? `${server.name} · ${pwName} ${server.version}` : `${pwName} server unreachable`}
            </div>
          </form>
        )}
        {!(needsSetup && !setupType) && <p className="mt-6 text-center text-[11px] text-ink-4">
          {plexSignIn || setupType === 'plex'
            ? 'You sign in on plex.tv. StreamForge never sees your Plex password.'
            : `Credentials are sent directly to your ${setupType === 'emby' ? 'Emby' : pwName} server and never stored.`}
        </p>}
      </motion.div>
    </div>
  );
}
