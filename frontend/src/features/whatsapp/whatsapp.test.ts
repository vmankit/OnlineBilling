import { describe, expect, it } from 'vitest';
import { buildWaLink, normalizeIndianMobile, reminderMessage } from './whatsapp';

describe('normalizeIndianMobile', () => {
  it('adds the country code to a plain 10-digit mobile', () => {
    expect(normalizeIndianMobile('9835012345')).toBe('919835012345');
  });

  it('keeps a number that already carries the country code', () => {
    expect(normalizeIndianMobile('919835012345')).toBe('919835012345');
    expect(normalizeIndianMobile('+91 98350 12345')).toBe('919835012345');
  });

  it('handles a 10-digit mobile that itself starts with 91', () => {
    // The shop really has this customer. Deciding by prefix instead of length
    // dropped the country code here and produced a dead wa.me link.
    expect(normalizeIndianMobile('9123456780')).toBe('919123456780');
  });

  it('strips the trunk zero', () => {
    expect(normalizeIndianMobile('09835012345')).toBe('919835012345');
    expect(normalizeIndianMobile('0919835012345')).toBe('919835012345');
  });

  it('strips the international dialling prefix', () => {
    expect(normalizeIndianMobile('00919835012345')).toBe('919835012345');
  });

  it('ignores spaces, dashes and brackets', () => {
    expect(normalizeIndianMobile('+91 (98350) 12-345')).toBe('919835012345');
  });

  it('leaves a foreign number with its own country code alone', () => {
    expect(normalizeIndianMobile('+1 415 555 0132')).toBe('14155550132');
  });

  it('returns null for anything it cannot understand', () => {
    expect(normalizeIndianMobile('')).toBeNull();
    expect(normalizeIndianMobile(null)).toBeNull();
    expect(normalizeIndianMobile('12345')).toBeNull();
    // Indian mobiles never start with 1-5.
    expect(normalizeIndianMobile('1234567890')).toBeNull();
  });
});

describe('buildWaLink', () => {
  it('addresses the chat when the number is usable', () => {
    const link = buildWaLink('9835012345', 'Hello');
    expect(link.startsWith('https://wa.me/919835012345?text=')).toBe(true);
  });

  it('still opens WhatsApp with the message when there is no number', () => {
    // A walk-in customer whose number was never taken: the operator picks the
    // chat rather than being sent to a dead one.
    expect(buildWaLink(null, 'Hello')).toBe('https://wa.me/?text=Hello');
    expect(buildWaLink('not a number', 'Hello')).toBe('https://wa.me/?text=Hello');
  });

  it('escapes newlines and symbols in the message', () => {
    const link = buildWaLink('9835012345', 'Total: Rs 1,200\nBaki: Rs 0');
    expect(link).toContain('%0A');
    expect(link).not.toContain('\n');
  });
});

describe('reminderMessage', () => {
  it('names the customer, the shop and the amount owed', () => {
    const msg = reminderMessage(
      { name: 'SANTU HARDWARE', phone: '7739802334', upiId: '7739802334-2@ybl' },
      'Aman Singh',
      12794.5,
    );
    expect(msg).toContain('Aman Singh');
    expect(msg).toContain('SANTU HARDWARE');
    expect(msg).toContain('12,794.50');
    expect(msg).toContain('7739802334-2@ybl');
  });
});
