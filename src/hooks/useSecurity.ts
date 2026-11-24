import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface MfaInfo {
  enabled: boolean;
  enabledAt?: string;
  recoveryLeft?: number;
  sso?: boolean;
}

export const useMfa = () => useQuery({ queryKey: ['me', 'mfa'], queryFn: ({ signal }) => api<MfaInfo>('/auth/mfa', { signal }) });
export const useMfaSetup = () => useMutation({ mutationFn: () => api<{ secret: string; uri: string }>('/auth/mfa/setup', { method: 'POST' }) });
export function useMfaEnable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api<MfaInfo & { recoveryCodes: string[] }>('/auth/mfa/enable', { method: 'POST', body: { code } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me', 'mfa'] }),
  });
}
export function useMfaDisable() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (code: string) => api<MfaInfo>('/auth/mfa/disable', { method: 'POST', body: { code } }), onSuccess: (d) => qc.setQueryData(['me', 'mfa'], d) });
}

/* --------------------------------- admin --------------------------------- */

export interface SsoSettings {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecretSet: boolean;
  clientSecretHint?: string;
  label: string;
  claim: string;
  hidePassword: boolean;
  redirectUri: string;
  hasApiKey: boolean;
  mfaUsers: { userId: string; userName: string; enabledAt: string }[];
}

export const useSso = () => useQuery({ queryKey: ['settings', 'sso'], queryFn: ({ signal }) => api<SsoSettings>('/settings/sso', { signal }) });
export function useSaveSso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: Partial<Omit<SsoSettings, 'clientSecretSet' | 'clientSecretHint' | 'redirectUri' | 'hasApiKey' | 'mfaUsers'>> & { clientSecret?: string }) => api('/settings/sso', { method: 'PUT', body: b }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings', 'sso'] }),
  });
}
export const useTestSso = () => useMutation({ mutationFn: (issuer: string) => api<{ ok: boolean; issuer?: string; matches?: boolean; message?: string }>('/settings/sso/test', { method: 'POST', body: { issuer } }) });
export function useResetMfa() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (userId: string) => api(`/settings/mfa/${userId}`, { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['settings', 'sso'] }) });
}
