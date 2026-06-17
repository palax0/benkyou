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
import { updateSettings } from '@benkyou/core/settings';
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

// A malformed id can only come from a tampered form, never the rendered UI;
// reject it here instead of letting Postgres throw 22P02 on the uuid cast.
const Uuid = z.uuid();

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
  const id = Uuid.safeParse(fd.get('id'));
  const values = {
    name: String(fd.get('name') ?? ''),
    url: String(fd.get('url') ?? ''),
    weight: String(fd.get('weight') ?? '1'),
  };
  if (!id.success) return { error: 'invalid', values };
  const parsed = SourceSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'invalid', values };
  await updateSource(id.data, parsed.data);
  revalidatePath('/sources');
  return {};
}

export async function toggleSourceAction(fd: FormData): Promise<void> {
  await requireAuth();
  const id = Uuid.safeParse(fd.get('id'));
  if (!id.success) return;
  await setSourceEnabled(id.data, fd.get('enabled') === 'true');
  revalidatePath('/sources');
}

export async function fetchSourceNowAction(fd: FormData): Promise<void> {
  await requireAuth();
  const id = Uuid.safeParse(fd.get('id'));
  if (!id.success) return;
  // Paused sources allow manual fetch (spec §6.2): pause only stops auto-polling.
  await triggerSourceFetch(id.data);
  revalidatePath('/sources');
}

export async function deleteSourceAction(fd: FormData): Promise<void> {
  await requireAuth();
  const id = Uuid.safeParse(fd.get('id'));
  if (!id.success) return;
  await deleteSource(id.data, { cascade: fd.get('cascade') === 'on' });
  revalidatePath('/sources');
}

export async function updateAdhocWeightAction(fd: FormData): Promise<void> {
  await requireAuth();
  const w = Number(fd.get('adhocSourceWeight') ?? '1');
  if (!Number.isFinite(w) || w < 0) return;
  await updateSettings({ adhocSourceWeight: String(w) });
  revalidatePath('/sources');
}
