// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  highlightAddresses,
  initContentScript,
  resetContentScriptForTest,
  sanitizeStellarAddress,
} from './content-script';

const ADDRESS = `G${'A'.repeat(55)}`;
const SECOND_ADDRESS = `G${'B'.repeat(55)}`;
const THIRD_ADDRESS = `G${'C'.repeat(55)}`;
const FOURTH_ADDRESS = `G${'D'.repeat(55)}`;
const FIFTH_ADDRESS = `G${'E'.repeat(55)}`;

describe('content script hostile-page hardening', () => {
  const sendMessage = vi.fn();

  beforeEach(() => {
    resetContentScriptForTest();
    document.body.replaceChildren();
    sendMessage.mockReset();
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage,
      },
    });
  });

  afterEach(() => {
    resetContentScriptForTest();
    vi.unstubAllGlobals();
  });

  it('accepts only complete Stellar-shaped addresses at the message boundary', () => {
    expect(sanitizeStellarAddress(ADDRESS)).toBe(ADDRESS);
    expect(sanitizeStellarAddress(`${ADDRESS}<script>alert(1)</script>`)).toBeNull();
    expect(sanitizeStellarAddress(`javascript:${ADDRESS}`)).toBeNull();
    expect(sanitizeStellarAddress({ toString: () => ADDRESS })).toBeNull();
  });

  it('keeps adjacent malicious markup inert while highlighting host text', () => {
    const hook = document.createElement('div');
    hook.textContent = `${ADDRESS}<img src=x onerror="globalThis.pwned=true"><script>globalThis.pwned=true</script>`;
    document.body.appendChild(hook);

    highlightAddresses(hook);

    const highlighted = hook.querySelector<HTMLSpanElement>('.greenpay-address');
    expect(highlighted?.textContent).toBe(ADDRESS);
    expect(hook.querySelector('img')).toBeNull();
    expect(hook.querySelector('script')).toBeNull();
    expect(hook.textContent).toContain('<img src=x onerror=');
  });

  it('highlights every original mixed sibling exactly once', () => {
    const hook = document.createElement('div');
    const emphasized = document.createElement('em');
    emphasized.textContent = SECOND_ADDRESS;
    const strong = document.createElement('strong');
    strong.textContent = FOURTH_ADDRESS;

    hook.append(
      document.createTextNode(`lead ${ADDRESS} tail`),
      emphasized,
      document.createTextNode(`middle ${THIRD_ADDRESS} gap`),
      strong,
      document.createTextNode(`end ${FIFTH_ADDRESS}`)
    );
    document.body.appendChild(hook);

    highlightAddresses(hook);

    const highlightedAddresses = Array.from(
      hook.querySelectorAll<HTMLSpanElement>('.greenpay-address'),
      span => span.textContent
    );
    expect(highlightedAddresses).toEqual([
      ADDRESS,
      SECOND_ADDRESS,
      THIRD_ADDRESS,
      FOURTH_ADDRESS,
      FIFTH_ADDRESS,
    ]);
  });

  it('sends the validated capture even if the hostile page rewrites injected DOM', () => {
    const hook = document.createElement('div');
    hook.textContent = ADDRESS;
    document.body.appendChild(hook);
    highlightAddresses(hook);

    const highlighted = hook.querySelector<HTMLSpanElement>('.greenpay-address');
    expect(highlighted).not.toBeNull();

    highlighted!.textContent = '<img src=x onerror=alert(1)>';
    highlighted!.dataset.address = 'javascript:alert(1)';
    highlighted!.click();

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith({
      action: 'openDonatePopup',
      address: ADDRESS,
    });
  });

  it('handles malicious dynamically-added text without recursive re-highlighting', async () => {
    initContentScript();
    const hook = document.createElement('div');
    hook.textContent = `${ADDRESS}<svg onload="globalThis.pwned=true">`;
    document.body.appendChild(hook);

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(hook.querySelectorAll('.greenpay-address')).toHaveLength(1);
    expect(hook.querySelector('svg')).toBeNull();
    hook.querySelector<HTMLSpanElement>('.greenpay-address')!.click();
    expect(sendMessage).toHaveBeenCalledWith({
      action: 'openDonatePopup',
      address: ADDRESS,
    });
  });
});
