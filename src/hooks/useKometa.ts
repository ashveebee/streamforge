import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ArtworkRef } from '@/lib/api';

export type ServerType = 'jellyfin' | 'plex' | 'emby';
export type SourceType = 'tmdb_list' | 'imdb_list' | 'trakt_list' | 'tmdb_trending_weekly' | 'tmdb_popular' | 'tmdb_keyword' | 'manual';
export type CollectionStatus = 'built' | 'waiting' | 'scheduled' | 'error';

export interface Library {
  server: string;
  serverType: ServerType;
  serverName: string;
  id: string;
  name: string;
  kind: 'movie' | 'show';
  kometaFile?: string;
}

export interface CollectionInput {
  name: string;
  library: { server: string; id: string };
  source: { type: SourceType; value?: string; ids?: number[]; limit?: number };
  schedule: 'always' | { from: string; to: string };
  order: 'custom' | 'release' | 'alpha';
  addMissing: boolean;
  visibleHome: boolean;
}

export interface CollectionSummary {
  id: string;
  name: string;
  managed: boolean;
  library: Library;
  source?: CollectionInput['source'];
  schedule?: CollectionInput['schedule'];
  count?: number;
  poster?: ArtworkRef;
  builtAt?: number;
  createdBy?: string;
  updatedAt?: string;
  waitingForRun?: boolean;
  status: CollectionStatus;
  error?: string;
}

export interface CollectionSettings {
  configDir: string;
  runTimes: string[];
  tmdbKeySet: boolean;
  tmdbKeyFromKometa: boolean;
  folder: { ok: boolean; message?: string; hasConfig?: boolean };
}

export interface CollectionList {
  settings: CollectionSettings;
  nextRun?: string;
  libraries: Library[];
  collections: CollectionSummary[];
}

export interface CollectionTitle {
  tmdbId?: number;
  title: string;
  year?: number;
  poster?: string | ArtworkRef;
  inLibrary: boolean;
  inCollection: boolean;
  new: boolean;
}

export interface CollectionDetail {
  id: string;
  name: string;
  managed: boolean;
  collection?: CollectionInput & { id: string; createdBy?: string; createdAt: string; updatedAt: string; library: Library };
  library: Library;
  kometaFile?: string;
  yaml?: string;
  poster?: ArtworkRef;
  openUrl?: string;
  status: CollectionStatus;
  error?: string;
  nextRun?: string;
  sourceKnown: boolean;
  counts: { onList?: number; inLibrary: number; missing?: number; inCollection: number };
  titles: CollectionTitle[];
  history: { at: string; event: string; created?: boolean; addedCount?: number; removedCount?: number; additions?: string[]; removals?: string[]; error?: string; message?: string }[];
}

export const useCollections = () => useQuery({ queryKey: ['kometa', 'collections'], queryFn: () => api<CollectionList>('/kometa/collections'), refetchInterval: 60_000 });
export const useCollection = (id: string) => useQuery({ queryKey: ['kometa', 'collection', id], queryFn: () => api<CollectionDetail>(`/kometa/collections/${encodeURIComponent(id)}`) });

export function useSaveCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: CollectionInput & { id?: string }) =>
      id ? api<{ id: string }>(`/kometa/collections/${id}`, { method: 'PUT', body: input }) : api<{ id: string }>('/kometa/collections', { method: 'POST', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['kometa'] }),
  });
}

export function useDeleteCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/kometa/collections/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['kometa'] }),
  });
}

export { SERVER_COLOR, SERVER_NAME } from '@/components/ui/ServerTag';
export const KOMETA_COLOR = '#f59e0b';

export const SOURCE_LABEL: Record<SourceType, string> = {
  tmdb_list: 'TMDb list',
  imdb_list: 'IMDb list',
  trakt_list: 'Trakt list',
  tmdb_trending_weekly: 'Trending on TMDb',
  tmdb_popular: 'Popular on TMDb',
  tmdb_keyword: 'TMDb keyword',
  manual: 'Hand-picked',
};
