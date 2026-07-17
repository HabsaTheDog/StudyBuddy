import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import { dismissCommonOverlays } from "../browserAuth.js";

describe("dismissCommonOverlays", () => {
  it("skips hidden and disabled controls and bounds actionable clicks", async () => {
    const hidden = overlayLocator({ visible: false });
    const disabled = overlayLocator({ enabled: false });
    const actionable = overlayLocator();
    const missing = overlayLocator({ count: 0 });
    const locators = [hidden, disabled, actionable, missing];
    const page = {
      locator: vi.fn(() => ({ first: () => locators.shift() })),
    } as unknown as Page;

    await dismissCommonOverlays(page);

    expect(hidden.click).not.toHaveBeenCalled();
    expect(disabled.click).not.toHaveBeenCalled();
    expect(actionable.click).toHaveBeenCalledWith({ timeout: 750 });
    expect(missing.isVisible).not.toHaveBeenCalled();
  });
});

function overlayLocator(options: { count?: number; visible?: boolean; enabled?: boolean } = {}) {
  return {
    count: vi.fn().mockResolvedValue(options.count ?? 1),
    isVisible: vi.fn().mockResolvedValue(options.visible ?? true),
    isEnabled: vi.fn().mockResolvedValue(options.enabled ?? true),
    click: vi.fn().mockResolvedValue(undefined),
  };
}
