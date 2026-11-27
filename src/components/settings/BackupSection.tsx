import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArchiveRestore, Download, LoaderCircle, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { t } from '@/i18n';

/** Encrypted export/import of everything saved in StreamForge. */
export function BackupSection() {
  const [pass, setPass] = useState('');
  const [history, setHistory] = useState(false);
  const [restorePass, setRestorePass] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const backup = useMutation({
    mutationFn: async () => {
      const data = await api<Record<string, unknown>>('/settings/backup', { method: 'POST', body: { passphrase: pass, history } });
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `streamforge-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
  const restore = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error(t('sec.backup.choose'));
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error(t('sec.backup.notBackup'));
      }
      return api<{ ok: boolean; restarting: boolean; counts: Record<string, number>; createdAt?: string }>('/settings/backup/restore', { method: 'POST', body: { passphrase: restorePass, file: parsed } });
    },
    onSuccess: (r) => {
      if (r.restarting) setTimeout(() => location.reload(), 6000);
    },
  });

  return (
    <section className="mt-8" aria-labelledby="backup-h">
      <h2 id="backup-h" className="mb-1 flex items-center gap-2 text-lg font-semibold tracking-tight"><ArchiveRestore className="size-4 text-brand" /> {t('sec.backup.title')}</h2>
      <p className="mb-3 text-xs text-ink-3">{t('sec.backup.intro')}</p>
      <Card>
        <div className="grid divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
          <form
            className="space-y-3 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              backup.mutate();
            }}
          >
            <h3 className="text-[13px] font-semibold">{t('sec.backup.download')}</h3>
            <Input type="password" autoComplete="new-password" placeholder={t('sec.backup.passPh')} value={pass} onChange={(e) => setPass(e.target.value)} aria-label={t('sec.backup.pass')} className="h-9" />
            <label className="flex items-center gap-2 text-xs text-ink-3">
              <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} className="accent-violet-500" /> {t('sec.backup.history')}
            </label>
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" variant="primary" disabled={backup.isPending || pass.length < 8}>
                {backup.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />} {t('sec.backup.downloadBtn')}
              </Button>
              {backup.error && <span className="text-xs text-bad">{(backup.error as Error).message}</span>}
              {backup.isSuccess && <span className="text-xs text-ok">{t('sec.backup.downloaded')}</span>}
            </div>
            <p className="text-[11px] text-ink-4">{t('sec.backup.need')}</p>
          </form>
          <form
            className="space-y-3 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (confirm(t('sec.backup.confirm'))) restore.mutate();
            }}
          >
            <h3 className="text-[13px] font-semibold">{t('sec.backup.restore')}</h3>
            <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Button type="button" size="sm" onClick={() => fileInput.current?.click()}>
              <Upload className="size-3.5" /> {file ? file.name : t('sec.backup.chooseBtn')}
            </Button>
            <Input type="password" autoComplete="off" placeholder={t('sec.backup.restorePh')} value={restorePass} onChange={(e) => setRestorePass(e.target.value)} aria-label={t('sec.backup.restorePass')} className="h-9" />
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={restore.isPending || !file || restorePass.length < 8}>
                {restore.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <ArchiveRestore className="size-3.5" />} {t('sec.backup.restoreBtn')}
              </Button>
              {restore.error && <span className="text-xs text-bad">{(restore.error as Error).message}</span>}
            </div>
            {restore.data && (
              <p className="text-xs text-ok">
                {t('sec.backup.restored')} {restore.data.restarting ? t('sec.backup.restarting') : t('sec.backup.restartHint')}
              </p>
            )}
          </form>
        </div>
      </Card>
    </section>
  );
}
