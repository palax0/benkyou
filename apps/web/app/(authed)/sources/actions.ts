'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  createSource,
  updateSource,
  deleteSource,
  setSourceEnabled,
  triggerSourceFetch,
} from '@benkyou/core/sources';
import { requireAuth } from '@/lib/auth';

export interface SourceFormState {
  error?: string;
  values?: { name: string; url: string; weight: string };
}

const SourceSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  weight: z.coerce.number().positive(),
});

export async function addSourceAction(_p: SourceFormState, fd: FormData): Promise<SourceFormState> {
  await requireAuth();
  const values = {
    name: String(fd.get('name') ?? ''),
    url: String(fd.get('url') ?? ''),
    weight: String(fd.get('weight') ?? '1'),
  };
  const parsed = SourceSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'invalid', values };
  const id = await createSource(parsed.data);
  await triggerSourceFetch(id); // auto-fetch on create (spec §6.2)
  revalidatePath('/sources');
  return {};
}

export async function editSourceAction(_p: SourceFormState, fd: FormData): Promise<SourceFormState> {
  await requireAuth();
  const id = String(fd.get('id') ?? '');
  const values = {
    name: String(fd.get('name') ?? ''),
    url: String(fd.get('url') ?? ''),
    weight: String(fd.get('weight') ?? '1'),
  };
  const parsed = SourceSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'invalid', values };
  await updateSource(id, parsed.data);
  revalidatePath('/sources');
  return {};
}

export async function toggleSourceAction(fd: FormData): Promise<void> {
  await requireAuth();
  await setSourceEnabled(String(fd.get('id')), fd.get('enabled') === 'true');
  revalidatePath('/sources');
}

export async function fetchSourceNowAction(fd: FormData): Promise<void> {
  await requireAuth();
  // Paused sources allow manual fetch (spec §6.2): pause only stops auto-polling.
  await triggerSourceFetch(String(fd.get('id')));
  revalidatePath('/sources');
}

export async function deleteSourceAction(fd: FormData): Promise<void> {
  await requireAuth();
  await deleteSource(String(fd.get('id')), { cascade: fd.get('cascade') === 'on' });
  revalidatePath('/sources');
}
