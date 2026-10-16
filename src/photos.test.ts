import { describe, expect, it, vi } from 'vitest';
import { syncPhotos } from './photos';

const pic = (n: string) => `data:image/jpeg;base64,${n}`;

describe('profile pictures', () => {
  it('only downloads pictures that are new or changed', async () => {
    const cached = { ravi: { image: pic('R1'), at: 't1' }, priya: { image: pic('P1'), at: 't1' } };
    const fetch = vi.fn(async (ids: string[]) => ids.map((id) => ({ person_id: id, image: pic(id), updated_at: 't2' })));
    const out = await syncPhotos(
      [
        { person_id: 'ravi', updated_at: 't1' }, // unchanged
        { person_id: 'priya', updated_at: 't2' }, // changed
        { person_id: 'kiran', updated_at: 't2' }, // new
      ],
      cached,
      fetch,
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toEqual(['priya', 'kiran']);
    expect(out).toEqual({
      ravi: cached.ravi,
      priya: { image: pic('priya'), at: 't2' },
      kiran: { image: pic('kiran'), at: 't2' },
    });
  });
  it('forgets pictures that were removed, without downloading anything', async () => {
    const fetch = vi.fn();
    const out = await syncPhotos([{ person_id: 'ravi', updated_at: 't1' }], { ravi: { image: pic('R'), at: 't1' }, gone: { image: pic('G'), at: 't1' } }, fetch);
    expect(Object.keys(out)).toEqual(['ravi']);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps showing the old picture when it can’t download the new one', async () => {
    const out = await syncPhotos([{ person_id: 'ravi', updated_at: 't2' }], { ravi: { image: pic('R'), at: 't1' } }, async () => {
      throw new Error('offline');
    });
    expect(out.ravi.image).toBe(pic('R'));
  });
  it('an older database without pictures leaves what we have', async () => {
    const cached = { ravi: { image: pic('R'), at: 't1' } };
    expect(await syncPhotos(undefined, cached, vi.fn())).toBe(cached);
  });
});
