import { describe, expect, it } from 'vitest';
import { renderTemplate } from './notify.service.js';

describe('renderTemplate', () => {
  it('fills both {{ spaced }} and {{tight}} placeholders', () => {
    expect(renderTemplate('Bill {{ invoice_no }} / {{grand_total}}', {
      invoice_no: 'INV-00012', grand_total: '640.00',
    })).toBe('Bill INV-00012 / 640.00');
  });

  it('drops a line whose value is missing instead of sending it half empty', () => {
    const out = renderTemplate('Total: {{ grand_total }}\n📲 Pay via UPI: {{ payment_link }}\nDhanyawad', {
      grand_total: '100.00', payment_link: '',
    });
    expect(out).toBe('Total: 100.00\nDhanyawad');
  });

  it('keeps headings that end in a colon but hold no placeholder', () => {
    const out = renderTemplate('💰 Payment Breakdown:\nTotal: {{ grand_total }}', { grand_total: '5.00' });
    expect(out).toBe('💰 Payment Breakdown:\nTotal: 5.00');
  });
});
