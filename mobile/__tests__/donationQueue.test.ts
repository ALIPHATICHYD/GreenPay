/**
 * __tests__/donationQueue.test.ts
 * Unit tests for the AsyncStorage-backed offline donation queue.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DONATION_QUEUE_KEY,
  enqueueDonation,
  listQueuedDonations,
  updateQueuedDonation,
  removeQueuedDonation,
} from '../utils/donationQueue';

describe('donationQueue', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('starts empty', async () => {
    const list = await listQueuedDonations();
    expect(list).toEqual([]);
  });

  it('enqueues a donation intent without a secret key field', async () => {
    const entry = await enqueueDonation({
      projectId: 'proj-1',
      projectName: 'Amazon Reforestation',
      donorAddress: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
      amountXLM: '5.0000000',
      message: 'Keep it green',
    });

    expect(entry.id).toEqual(expect.any(String));
    expect(entry.status).toBe('pending-sync');
    expect(entry.projectId).toBe('proj-1');
    expect(entry.donorAddress).toBe('GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN');
    expect(entry).not.toHaveProperty('secretKey');

    const raw = await AsyncStorage.getItem(DONATION_QUEUE_KEY);
    expect(raw).toContain('proj-1');
    expect(raw).not.toMatch(/S[A-Z0-9]{55}/); // never persist anything secret-key-shaped
  });

  it('lists queued donations, most recent first', async () => {
    await enqueueDonation({
      projectId: 'proj-1',
      projectName: 'Project One',
      donorAddress: 'GABC',
      amountXLM: '1',
    });
    await enqueueDonation({
      projectId: 'proj-2',
      projectName: 'Project Two',
      donorAddress: 'GABC',
      amountXLM: '2',
    });

    const list = await listQueuedDonations();
    expect(list).toHaveLength(2);
    expect(list[0].projectId).toBe('proj-2');
    expect(list[1].projectId).toBe('proj-1');
  });

  it('updates a queued donation in place', async () => {
    const entry = await enqueueDonation({
      projectId: 'proj-1',
      projectName: 'Project One',
      donorAddress: 'GABC',
      amountXLM: '1',
    });

    const updated = await updateQueuedDonation(entry.id, {
      status: 'conflict',
      conflictReason: 'insufficient-balance',
      conflictDetail: 'Available: 0.50 XLM, required: 1.50 XLM',
    });

    expect(updated).toHaveLength(1);
    expect(updated[0].status).toBe('conflict');
    expect(updated[0].conflictReason).toBe('insufficient-balance');

    const list = await listQueuedDonations();
    expect(list[0].conflictDetail).toBe('Available: 0.50 XLM, required: 1.50 XLM');
  });

  it('removes a queued donation', async () => {
    const first = await enqueueDonation({
      projectId: 'proj-1',
      projectName: 'Project One',
      donorAddress: 'GABC',
      amountXLM: '1',
    });
    await enqueueDonation({
      projectId: 'proj-2',
      projectName: 'Project Two',
      donorAddress: 'GABC',
      amountXLM: '2',
    });

    const remaining = await removeQueuedDonation(first.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].projectId).toBe('proj-2');

    const list = await listQueuedDonations();
    expect(list).toHaveLength(1);
  });

  it('recovers gracefully from corrupted storage', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('not-json');
    const list = await listQueuedDonations();
    expect(list).toEqual([]);
  });
});
